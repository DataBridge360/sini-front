import { describe, expect, it } from "vitest";
import type { TaskListItem } from "@/lib/api";
import { buildTaskAlerts, countUnreadAlerts, daysUntilDate } from "@/lib/task-alerts";

const NOW = new Date(2026, 9, 26, 15, 30); // 26/10/2026, hora local
const ME = "me";
const OTHER = "other";

function task(overrides: Partial<TaskListItem> & { id: string }): TaskListItem {
  return {
    title: `Tarea ${overrides.id}`,
    status: "pendiente",
    priority: "media",
    due_date: null,
    created_at: "2026-10-01T10:00:00Z",
    updated_at: "2026-10-01T10:00:00Z",
    archived_at: null,
    assigned_to_user_id: ME,
    created_by_user_id: ME,
    approved_by_user_id: null,
    assigned_to: null,
    created_by: null,
    approved_by: null,
    messages_count: 0,
    attachments_count: 0,
    ...overrides
  } as TaskListItem;
}

const build = (tasks: TaskListItem[], canModerate = false) =>
  buildTaskAlerts(tasks, { currentUserId: ME, canModerate, now: NOW });

describe("daysUntilDate", () => {
  it("counts calendar days in local time, ignoring the hour", () => {
    expect(daysUntilDate("2026-10-26", NOW)).toBe(0);
    expect(daysUntilDate("2026-10-27", NOW)).toBe(1);
    expect(daysUntilDate("2026-10-25", NOW)).toBe(-1);
  });
});

describe("buildTaskAlerts", () => {
  it("flags my unfinished tasks that are overdue, due today or due tomorrow", () => {
    const alerts = build([
      task({ id: "late", due_date: "2026-10-24" }),
      task({ id: "today", due_date: "2026-10-26" }),
      task({ id: "tomorrow", due_date: "2026-10-27" }),
      task({ id: "later", due_date: "2026-10-30" }),
      task({ id: "nodate", due_date: null })
    ]);
    expect(alerts.map((alert) => [alert.kind, alert.task.id])).toEqual([
      ["overdue", "late"],
      ["due_today", "today"],
      ["due_tomorrow", "tomorrow"]
    ]);
    expect(alerts[0]?.daysUntilDue).toBe(-2);
  });

  it("ignores finished or archived tasks and tasks assigned to someone else", () => {
    const alerts = build([
      task({ id: "done", due_date: "2026-10-24", status: "finalizado" }),
      task({ id: "archived", due_date: "2026-10-24", archived_at: "2026-10-25T00:00:00Z" }),
      task({ id: "theirs", due_date: "2026-10-24", assigned_to_user_id: OTHER })
    ]);
    expect(alerts).toEqual([]);
  });

  it("includes unassigned tasks I created", () => {
    const alerts = build([task({ id: "orphan", due_date: "2026-10-26", assigned_to_user_id: null })]);
    expect(alerts.map((alert) => alert.task.id)).toEqual(["orphan"]);
  });

  it("tells me about tasks someone else assigned to me in the last 3 days", () => {
    const alerts = build([
      task({ id: "fresh", created_by_user_id: OTHER, created_at: "2026-10-25T12:00:00Z" }),
      task({ id: "old", created_by_user_id: OTHER, created_at: "2026-10-10T12:00:00Z" }),
      task({ id: "self", created_at: "2026-10-25T12:00:00Z" })
    ]);
    expect(alerts.map((alert) => [alert.kind, alert.task.id])).toEqual([["assigned", "fresh"]]);
  });

  it("asks moderators to approve any task in review, and nobody else", () => {
    const inReview = task({ id: "review", status: "revision", assigned_to_user_id: OTHER });
    expect(build([inReview], true).map((alert) => alert.kind)).toEqual(["review"]);
    expect(build([inReview], false)).toEqual([]);
  });

  it("keeps one due alert per task, with a key that changes when the alert changes", () => {
    const [today] = build([task({ id: "t", due_date: "2026-10-26", created_by_user_id: OTHER, created_at: "2026-10-26T09:00:00Z" })]);
    const [moved] = build([task({ id: "t", due_date: "2026-10-27", created_by_user_id: OTHER, created_at: "2026-10-26T09:00:00Z" })]);
    expect(today?.kind).toBe("due_today");
    expect(moved?.kind).toBe("due_tomorrow");
    expect(today?.id).not.toBe(moved?.id);
  });
});

describe("countUnreadAlerts", () => {
  it("counts the alerts whose id is not marked as read", () => {
    const alerts = build([
      task({ id: "a", due_date: "2026-10-24" }),
      task({ id: "b", due_date: "2026-10-26" })
    ]);
    expect(countUnreadAlerts(alerts, new Set())).toBe(2);
    expect(countUnreadAlerts(alerts, new Set([alerts[0]!.id]))).toBe(1);
  });
});
