import { describe, expect, it } from "vitest";
import type { TaskListItem } from "@/lib/api";
import {
  buildDaySummary,
  buildWorkGroups,
  firstNameOf,
  greetingForHour
} from "@/components/dashboard/dashboard-helpers";

describe("greetingForHour", () => {
  it("says Buen día from 6 to 12, Buenas tardes from 13 to 19, Buenas noches otherwise", () => {
    expect(greetingForHour(5)).toBe("Buenas noches");
    expect(greetingForHour(6)).toBe("Buen día");
    expect(greetingForHour(12)).toBe("Buen día");
    expect(greetingForHour(13)).toBe("Buenas tardes");
    expect(greetingForHour(19)).toBe("Buenas tardes");
    expect(greetingForHour(20)).toBe("Buenas noches");
  });
});

describe("firstNameOf", () => {
  it("uses the first word of the name, or a neutral fallback", () => {
    expect(firstNameOf("Lucas Segura")).toBe("Lucas");
    expect(firstNameOf("  ")).toBe("equipo");
    expect(firstNameOf("")).toBe("equipo");
  });
});

const NOW = new Date(2026, 9, 26, 10, 0);

function task(overrides: Partial<TaskListItem> & { id: string }): TaskListItem {
  return {
    title: `Tarea ${overrides.id}`,
    status: "pendiente",
    priority: "media",
    due_date: null,
    created_at: "2026-10-01T10:00:00Z",
    updated_at: "2026-10-01T10:00:00Z",
    archived_at: null,
    assigned_to_user_id: "me",
    created_by_user_id: "me",
    approved_by_user_id: null,
    assigned_to: null,
    created_by: null,
    approved_by: null,
    messages_count: 0,
    attachments_count: 0,
    ...overrides
  } as TaskListItem;
}

const groupsOf = (tasks: TaskListItem[], canModerate = false) =>
  buildWorkGroups(tasks, { currentUserId: "me", canModerate, now: NOW });

describe("buildWorkGroups", () => {
  it("orders my work as overdue, today, tomorrow, review and later, skipping empty groups", () => {
    const groups = groupsOf(
      [
        task({ id: "nodate" }),
        task({ id: "later", due_date: "2026-10-30" }),
        task({ id: "tomorrow", due_date: "2026-10-27" }),
        task({ id: "today", due_date: "2026-10-26" }),
        task({ id: "late", due_date: "2026-10-20" }),
        task({ id: "review", status: "revision", assigned_to_user_id: "other" })
      ],
      true
    );
    expect(groups.map((group) => [group.key, group.items.map((item) => item.task.id)])).toEqual([
      ["overdue", ["late"]],
      ["today", ["today"]],
      ["tomorrow", ["tomorrow"]],
      ["review", ["review"]],
      ["later", ["later", "nodate"]]
    ]);
  });

  it("leaves out other people's tasks, and review for non moderators", () => {
    const groups = groupsOf([
      task({ id: "theirs", due_date: "2026-10-26", assigned_to_user_id: "other" }),
      task({ id: "review", status: "revision" })
    ]);
    expect(groups).toEqual([]);
  });
});

describe("buildDaySummary", () => {
  const summary = (tasks: TaskListItem[], canModerate = false) => buildDaySummary(groupsOf(tasks, canModerate));

  it("says what is due today and overdue in one sentence", () => {
    expect(
      summary([
        task({ id: "a", due_date: "2026-10-26" }),
        task({ id: "b", due_date: "2026-10-26" }),
        task({ id: "c", due_date: "2026-10-20" })
      ])
    ).toBe("Tenés 2 tareas para hoy y 1 vencida.");
    expect(summary([task({ id: "c", due_date: "2026-10-20" })])).toBe("Tenés 1 tarea vencida.");
  });

  it("adds tasks awaiting approval for moderators", () => {
    expect(
      summary([task({ id: "a", due_date: "2026-10-26" }), task({ id: "r", status: "revision" })], true)
    ).toBe("Tenés 1 tarea para hoy y 1 tarea esperando tu aprobación.");
  });

  it("looks ahead when nothing is urgent, and cheers when there is nothing at all", () => {
    expect(summary([task({ id: "t", due_date: "2026-10-27" })])).toBe("Hoy no hay nada urgente. Mañana tenés 1 tarea.");
    expect(summary([task({ id: "l", due_date: "2026-11-05" })])).toBe("Nada urgente por hoy. Tenés 1 tarea más adelante.");
    expect(summary([])).toBe("Estás al día: no tenés tareas pendientes. ¡Buen momento para adelantar avisos!");
  });
});
