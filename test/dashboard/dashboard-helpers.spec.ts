import { describe, expect, it } from "vitest";
import type { TaskListItem } from "@/lib/api";
import {
  buildDaySegments,
  buildDaySummary,
  buildHeroSummary,
  buildNoticeSummary,
  buildTaskFeed,
  buildUpcomingList,
  buildWorkGroups,
  firstNameOf,
  greetingForHour,
  shortDayLabel,
  taskContext
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

// Relaciones que `task()` no arma: cliente y póliza de la tarea.
function relations(client: string | null, policyNumber: string | null) {
  return {
    clients: client ? { full_name: client } : null,
    policies: policyNumber ? { policy_number: policyNumber } : null
  } as unknown as Pick<TaskListItem, "clients" | "policies">;
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

describe("buildDaySegments", () => {
  it("highlights the counts, and paints overdue as its own tone", () => {
    const segments = buildDaySegments(
      groupsOf([
        task({ id: "a", due_date: "2026-10-26" }),
        task({ id: "b", due_date: "2026-10-26" }),
        task({ id: "c", due_date: "2026-10-20" })
      ])
    );
    expect(segments.filter((segment) => segment.tone).map((segment) => [segment.text, segment.tone])).toEqual([
      ["2 tareas", "count"],
      ["1 vencida", "overdue"]
    ]);
  });

  it("has no highlighted segment when there is nothing to do", () => {
    expect(buildDaySegments([]).some((segment) => segment.tone)).toBe(false);
  });
});

describe("buildTaskFeed", () => {
  const tasks = [
    task({ id: "far", due_date: "2026-11-20" }),
    task({ id: "thursday", due_date: "2026-10-29" }),
    task({ id: "tomorrow", due_date: "2026-10-27" }),
    task({ id: "today", due_date: "2026-10-26" }),
    task({ id: "late", due_date: "2026-10-24" }),
    task({ id: "yesterday", due_date: "2026-10-25" }),
    task({ id: "nodate" }),
    task({ id: "review", status: "revision", assigned_to_user_id: "other" })
  ];

  it("sections the tasks by date, with the label and status of each row", () => {
    const { sections, shown, total } = buildTaskFeed(groupsOf(tasks, true), 10);
    expect(sections.map((section) => [section.title, section.rows.map((row) => row.task.id)])).toEqual([
      ["Vencidas", ["late", "yesterday"]],
      ["Hoy", ["today"]],
      ["Mañana", ["tomorrow"]],
      ["Próximas", ["thursday", "far"]],
      ["Esperan tu aprobación", ["review"]]
    ]);
    expect(sections.flatMap((section) => section.rows.map((row) => [row.dueLabel, row.statusLabel]))).toEqual([
      ["Hace 2 días", "Pendiente"],
      ["Ayer", "Pendiente"],
      ["Hoy", "Pendiente"],
      ["Mañana", "Pendiente"],
      ["Jue 29", "Pendiente"],
      ["Vie 20", "Pendiente"],
      ["Por aprobar", "En revisión"]
    ]);
    expect([shown, total]).toEqual([7, 7]);
  });

  it("leaves out undated tasks and, for non moderators, tasks to approve", () => {
    const { sections, total } = buildTaskFeed(groupsOf(tasks), 10);
    const ids = sections.flatMap((section) => section.rows.map((row) => row.task.id));
    expect(ids).not.toContain("nodate");
    expect(ids).not.toContain("review");
    expect(total).toBe(6);
  });

  it("caps the rows across sections but keeps the real total", () => {
    const { sections, shown, total } = buildTaskFeed(groupsOf(tasks, true), 3);
    expect(sections.map((section) => [section.state, section.rows.length])).toEqual([
      ["overdue", 2],
      ["today", 1]
    ]);
    expect([shown, total]).toEqual([3, 7]);
  });

  it("shows the date of a task in review when it has one", () => {
    const { sections } = buildTaskFeed(
      groupsOf([task({ id: "r", status: "revision", assigned_to_user_id: "other", due_date: "2026-10-26" })], true),
      10
    );
    expect(sections[0]?.rows[0]?.dueLabel).toBe("Hoy");
  });

  it("is empty when nothing has a date", () => {
    expect(buildTaskFeed(groupsOf([task({ id: "nodate" })]), 10)).toEqual({ sections: [], shown: 0, total: 0 });
  });
});

describe("buildHeroSummary", () => {
  const summary = (tasks: TaskListItem[]) => buildHeroSummary(groupsOf(tasks));

  it("counts overdue plus today as the big number, and lists overdue and tomorrow below", () => {
    expect(
      summary([
        task({ id: "a", due_date: "2026-10-26" }),
        task({ id: "b", due_date: "2026-10-20" }),
        task({ id: "c", due_date: "2026-10-19" }),
        task({ id: "d", due_date: "2026-10-27" })
      ])
    ).toEqual({ count: 3, label: "tareas para hoy", detail: "2 vencidas · 1 para mañana" });
  });

  it("omits the zero parts and uses the singular", () => {
    expect(summary([task({ id: "a", due_date: "2026-10-26" })])).toEqual({
      count: 1,
      label: "tarea para hoy",
      detail: "Nada vencido"
    });
    expect(summary([task({ id: "a", due_date: "2026-10-26" }), task({ id: "b", due_date: "2026-10-25" })]).detail).toBe(
      "1 vencida"
    );
  });

  it("says the person is up to date when nothing is due today or overdue", () => {
    expect(summary([])).toEqual({ count: 0, label: "tareas para hoy", detail: "Estás al día" });
    expect(summary([task({ id: "t", due_date: "2026-10-27" })]).detail).toBe("Estás al día · 1 para mañana");
  });
});

describe("buildNoticeSummary", () => {
  const notice = (status: string) => ({ status });

  it("counts the notices to contact and the share already paid", () => {
    const notices = [...Array(2).fill(notice("avisar")), notice("avisado"), notice("pagado")];
    expect(buildNoticeSummary(notices)).toEqual({ toContact: 2, collectionPct: 25 });
  });

  it("has no collection share without notices", () => {
    expect(buildNoticeSummary([])).toEqual({ toContact: 0, collectionPct: null });
  });
});

describe("taskContext", () => {
  it("joins client and policy number, and tolerates missing parts", () => {
    expect(
      taskContext(
        task({ id: "a", ...relations("Ana Pérez", "7781-03") })
      )
    ).toBe("Ana Pérez · 7781-03");
    expect(taskContext(task({ id: "b" }))).toBe("");
  });
});

describe("buildUpcomingList / shortDayLabel", () => {
  it("lists every dated task after tomorrow, soonest first, up to the limit", () => {
    const groups = groupsOf([
      task({ id: "far", due_date: "2026-11-20" }),
      task({ id: "thursday", due_date: "2026-10-29" }),
      task({ id: "friday", due_date: "2026-10-30" }),
      task({ id: "tomorrow", due_date: "2026-10-27" }),
      task({ id: "nodate" })
    ]);
    expect(buildUpcomingList(groups, 5).map((item) => item.task.id)).toEqual(["thursday", "friday", "far"]);
    expect(buildUpcomingList(groups, 2).map((item) => item.task.id)).toEqual(["thursday", "friday"]);
  });

  it("formats a date as weekday and day", () => {
    expect(shortDayLabel("2026-10-29")).toBe("Jue 29");
    expect(shortDayLabel("2026-11-01")).toBe("Dom 1");
  });
});
