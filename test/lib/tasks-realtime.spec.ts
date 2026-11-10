import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TaskDetail, TaskListItem } from "@/lib/api";
import { queryKeysForEvent, type OrgChangeEvent } from "@/lib/realtime";
import {
  applyTaskDetailToCache,
  applyTaskSync,
  applyTaskSyncPlan,
  beginLocalTaskChange,
  endLocalTaskChange,
  isDetailOnlyTaskUpdate,
  syncTasksByIds,
  TASK_PATCH_MAX,
  taskIdOfEvent,
  TaskSyncBatch,
  taskListItemFromDetail,
  tasksByIdsPath
} from "@/lib/tasks-realtime";

function task(id: string, overrides: Partial<TaskListItem> = {}): TaskListItem {
  return {
    id,
    title: `Task ${id}`,
    status: "pendiente",
    priority: "media",
    due_date: "2026-11-10",
    created_at: "2026-11-01T10:00:00Z",
    updated_at: "2026-11-01T10:00:00Z",
    archived_at: null,
    assigned_to_user_id: null,
    created_by_user_id: "u1",
    approved_by_user_id: null,
    assigned_to: null,
    created_by: null,
    approved_by: null,
    messages_count: 0,
    attachments_count: 0,
    ...overrides
  };
}

const event = (overrides: Partial<OrgChangeEvent>): OrgChangeEvent => ({
  entity: "task",
  entity_id: "t1",
  action: "update",
  organization_id: "org",
  ...overrides
});

describe("taskIdOfEvent", () => {
  it("uses entity_id for a task and parent_id for messages and files", () => {
    expect(taskIdOfEvent(event({}))).toBe("t1");
    expect(taskIdOfEvent(event({ entity: "task_message", entity_id: "m1", parent_id: "t2" }))).toBe("t2");
    expect(taskIdOfEvent(event({ entity: "task_attachment", entity_id: "a1", parent_id: "t3" }))).toBe("t3");
    expect(taskIdOfEvent(event({ entity: "task_message", entity_id: "m1" }))).toBeNull();
    expect(taskIdOfEvent(event({ entity: "policy_notice" }))).toBeNull();
  });
});

describe("queryKeysForEvent for tasks", () => {
  it("only keeps the open detail when the event identifies the task", () => {
    expect(queryKeysForEvent(event({}), "norte")).toEqual([["task", "norte", "t1"]]);
    expect(queryKeysForEvent(event({ entity: "task_message", entity_id: "m", parent_id: "t2" }), "norte")).toEqual([
      ["task", "norte", "t2"]
    ]);
  });

  it("refetches the board when a message has no task id", () => {
    expect(queryKeysForEvent(event({ entity: "task_message", entity_id: "m" }), "norte")).toEqual([["tasks", "norte"]]);
  });
});

describe("isDetailOnlyTaskUpdate", () => {
  it("is true only for description-only updates", () => {
    expect(isDetailOnlyTaskUpdate(event({ fields: ["description"] }))).toBe(true);
    expect(isDetailOnlyTaskUpdate(event({ fields: ["description", "title"] }))).toBe(false);
    expect(isDetailOnlyTaskUpdate(event({ fields: [] }))).toBe(false);
    expect(isDetailOnlyTaskUpdate(event({ action: "insert", fields: ["description"] }))).toBe(false);
  });
});

describe("TaskSyncBatch", () => {
  it("ignores events that are not about tasks", () => {
    const batch = new TaskSyncBatch();
    expect(batch.add(event({ entity: "policy_notice" }))).toBe(false);
    expect(batch.isEmpty).toBe(true);
  });

  it("does nothing for a description-only update", () => {
    const batch = new TaskSyncBatch();
    expect(batch.add(event({ fields: ["description"] }))).toBe(true);
    expect(batch.isEmpty).toBe(true);
  });

  it("dedupes a burst into one fetch per task", () => {
    const batch = new TaskSyncBatch();
    batch.add(event({ fields: ["title"] }));
    batch.add(event({ entity: "task_message", entity_id: "m1", action: "insert", parent_id: "t1" }));
    batch.add(event({ entity: "task_attachment", entity_id: "a1", action: "insert", parent_id: "t2" }));
    const plan = batch.drain();
    expect(plan.fetchIds.sort()).toEqual(["t1", "t2"]);
    expect(plan.removeIds).toEqual([]);
    expect(plan.invalidate).toBe(false);
    expect(batch.isEmpty).toBe(true);
  });

  it("removes a hard-deleted task without a request, even if its messages report later", () => {
    const batch = new TaskSyncBatch();
    batch.add(event({ action: "delete" }));
    batch.add(event({ entity: "task_message", entity_id: "m1", action: "delete", parent_id: "t1" }));
    const plan = batch.drain();
    expect(plan.removeIds).toEqual(["t1"]);
    expect(plan.fetchIds).toEqual([]);
  });

  it("falls back to a full refetch without an id or past the cap", () => {
    const noId = new TaskSyncBatch();
    noId.add(event({ entity: "task_message", entity_id: "m1" }));
    const plan = noId.drain();
    expect(plan).toMatchObject({ invalidate: true, invalidateStats: true, invalidateArchived: true });

    const big = new TaskSyncBatch();
    for (let i = 0; i <= TASK_PATCH_MAX; i += 1) big.add(event({ entity_id: `t${i}`, fields: ["title"] }));
    expect(big.drain().invalidate).toBe(true);
  });

  it("flags the counters only when an event can change them", () => {
    const inserted = new TaskSyncBatch();
    inserted.add(event({ action: "insert" }));
    expect(inserted.drain(() => true)).toMatchObject({ invalidateStats: true, invalidateArchived: false });

    const retitled = new TaskSyncBatch();
    retitled.add(event({ fields: ["title", "priority"] }));
    expect(retitled.drain(() => true)).toMatchObject({ invalidateStats: false, invalidateArchived: false });

    const reassigned = new TaskSyncBatch();
    reassigned.add(event({ fields: ["assigned_to_user_id"] }));
    expect(reassigned.drain(() => true)).toMatchObject({ invalidateStats: true, invalidateArchived: false });

    const commented = new TaskSyncBatch();
    commented.add(event({ entity: "task_message", entity_id: "m", action: "insert", parent_id: "t1" }));
    expect(commented.drain(() => true)).toMatchObject({ invalidateStats: false, invalidateArchived: false });
  });

  it("flags the archived list for archive moves, unknown fields and tasks the board does not hold", () => {
    const archived = new TaskSyncBatch();
    archived.add(event({ fields: ["status", "archived_at"] }));
    expect(archived.drain(() => true)).toMatchObject({ invalidateStats: true, invalidateArchived: true });

    const unknown = new TaskSyncBatch();
    unknown.add(event({}));
    expect(unknown.drain(() => true)).toMatchObject({ invalidateStats: true, invalidateArchived: true });

    const offBoard = new TaskSyncBatch();
    offBoard.add(event({ fields: ["title"] }));
    expect(offBoard.drain(() => false).invalidateArchived).toBe(true);

    const deletedOffBoard = new TaskSyncBatch();
    deletedOffBoard.add(event({ action: "delete" }));
    expect(deletedOffBoard.drain(() => false)).toMatchObject({ invalidateStats: true, invalidateArchived: true });
    const deletedOnBoard = new TaskSyncBatch();
    deletedOnBoard.add(event({ action: "delete" }));
    expect(deletedOnBoard.drain(() => true).invalidateArchived).toBe(false);
  });
});

describe("applyTaskSync", () => {
  it("replaces, adds and drops, keeping the server order", () => {
    const list = [task("a", { due_date: "2026-11-01" }), task("b", { due_date: "2026-11-05" }), task("c", { due_date: null })];
    const next = applyTaskSync(list, {
      fetched: [task("b", { title: "Renamed", due_date: "2026-11-05" }), task("d", { due_date: "2026-11-03" })],
      requestedIds: ["b", "d", "c"]
    });
    expect(next.map((item) => item.id)).toEqual(["a", "d", "b"]);
    expect(next.find((item) => item.id === "b")?.title).toBe("Renamed");
  });

  it("re-sorts when a due date moves and puts undated tasks last", () => {
    const list = [task("a", { due_date: "2026-11-01" }), task("b", { due_date: "2026-11-05" })];
    const next = applyTaskSync(list, { fetched: [task("a", { due_date: null })] });
    expect(next.map((item) => item.id)).toEqual(["b", "a"]);
  });

  it("returns the same array when nothing changed", () => {
    const list = [task("a"), task("b")];
    expect(applyTaskSync(list, { fetched: [task("a")], requestedIds: ["a"] })).toBe(list);
  });

  it("honours explicit removals", () => {
    expect(applyTaskSync([task("a"), task("b")], { fetched: [], removeIds: ["a"] }).map((item) => item.id)).toEqual(["b"]);
  });
});

describe("syncTasksByIds", () => {
  const seed = (client: QueryClient, list: TaskListItem[]) => client.setQueryData(["tasks", "norte"], list);

  it("patches the cache with one read", async () => {
    const client = new QueryClient();
    seed(client, [task("a"), task("b")]);
    const fetcher = vi.fn().mockResolvedValue([task("a", { messages_count: 2 })]);
    expect(await syncTasksByIds(client, "norte", ["a", "b", "a"], fetcher)).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(["a", "b"]);
    // b did not come back (archived or deleted): it leaves the board.
    expect(client.getQueryData<TaskListItem[]>(["tasks", "norte"])).toEqual([task("a", { messages_count: 2 })]);
  });

  it("refetches the whole board when the read fails", async () => {
    const client = new QueryClient();
    seed(client, [task("a")]);
    const spy = vi.spyOn(client, "invalidateQueries");
    expect(await syncTasksByIds(client, "norte", ["a"], vi.fn().mockRejectedValue(new Error("boom")))).toBe(false);
    expect(spy).toHaveBeenCalledWith({ queryKey: ["tasks", "norte"] });
  });

  it("does not create a board cache that was never loaded", async () => {
    const client = new QueryClient();
    await syncTasksByIds(client, "norte", ["a"], vi.fn().mockResolvedValue([task("a")]));
    expect(client.getQueryData(["tasks", "norte"])).toBeUndefined();
  });

  it("builds the ids path", () => {
    expect(tasksByIdsPath(["a", "b"])).toBe("/tasks?ids=a,b");
  });
});

describe("local changes protect optimistic moves", () => {
  afterEach(() => {
    // Leave no pending local change behind for other tests.
    while (endLocalTaskChange("a")) {
      /* drain */
    }
  });

  it("holds a realtime patch for a task with a move in flight and reports it once settled", async () => {
    const client = new QueryClient();
    // The card was dragged to "en_proceso" optimistically.
    client.setQueryData(["tasks", "norte"], [task("a", { status: "en_proceso" }), task("b")]);
    beginLocalTaskChange("a");

    // A patch read just before the server confirmed the move still says "pendiente".
    const fetcher = vi.fn().mockResolvedValue([task("a", { status: "pendiente", title: "Edited elsewhere" })]);
    await syncTasksByIds(client, "norte", ["a"], fetcher);
    expect(client.getQueryData<TaskListItem[]>(["tasks", "norte"])?.[0]?.status).toBe("en_proceso");
    expect(client.getQueryData<TaskListItem[]>(["tasks", "norte"])?.[0]?.title).toBe("Task a");

    expect(endLocalTaskChange("a")).toBe(true);
    await syncTasksByIds(client, "norte", ["a"], vi.fn().mockResolvedValue([task("a", { status: "en_proceso", title: "Edited elsewhere" })]));
    expect(client.getQueryData<TaskListItem[]>(["tasks", "norte"])?.[0]?.title).toBe("Edited elsewhere");
  });

  it("does not hold other tasks, and reports nothing when no patch was held", async () => {
    const client = new QueryClient();
    client.setQueryData(["tasks", "norte"], [task("a"), task("b")]);
    beginLocalTaskChange("a");
    await syncTasksByIds(client, "norte", ["b"], vi.fn().mockResolvedValue([task("b", { title: "New" })]));
    expect(client.getQueryData<TaskListItem[]>(["tasks", "norte"])?.[1]?.title).toBe("New");
    expect(endLocalTaskChange("a")).toBe(false);
  });

  it("holds removals too, so a delete read mid-move is applied after it settles", async () => {
    const client = new QueryClient();
    client.setQueryData(["tasks", "norte"], [task("a")]);
    beginLocalTaskChange("a");
    await applyTaskSyncPlan(
      client,
      "norte",
      { fetchIds: [], removeIds: ["a"], invalidate: false, invalidateStats: false, invalidateArchived: false },
      vi.fn()
    );
    expect(client.getQueryData<TaskListItem[]>(["tasks", "norte"])).toHaveLength(1);
    expect(endLocalTaskChange("a")).toBe(true);
  });
});

describe("applyTaskSyncPlan", () => {
  it("invalidates only the keys the plan flags, and patches instead of refetching the board", async () => {
    const client = new QueryClient();
    client.setQueryData(["tasks", "norte"], [task("a")]);
    const spy = vi.spyOn(client, "invalidateQueries");
    const fetcher = vi.fn().mockResolvedValue([task("a", { messages_count: 1 })]);
    await applyTaskSyncPlan(
      client,
      "norte",
      { fetchIds: ["a"], removeIds: [], invalidate: false, invalidateStats: false, invalidateArchived: true },
      fetcher
    );
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ queryKey: ["tasks-archived", "norte"] });
    expect(client.getQueryData<TaskListItem[]>(["tasks", "norte"])?.[0]?.messages_count).toBe(1);
  });

  it("refetches the board without reading ids when the plan says so", async () => {
    const client = new QueryClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    const fetcher = vi.fn();
    await applyTaskSyncPlan(
      client,
      "norte",
      { fetchIds: ["a"], removeIds: [], invalidate: true, invalidateStats: true, invalidateArchived: false },
      fetcher
    );
    expect(fetcher).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalledWith({ queryKey: ["tasks", "norte"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["task-stats", "norte"] });
  });
});

describe("mutation responses", () => {
  const detail = (overrides: Partial<TaskDetail> = {}): TaskDetail => {
    const { messages_count: _m, attachments_count: _a, ...base } = task("a");
    void _m;
    void _a;
    return {
      ...base,
      description: { type: "doc" },
      messages: [
        { id: "m1", message: "hi", created_at: "x", user_id: "u1", user: null, attachments: [{ id: "f1" } as never] },
        { id: "m2", message: null, created_at: "x", user_id: "u1", user: null, attachments: [] }
      ],
      attachments: [{ id: "f2" } as never],
      ...overrides
    };
  };

  it("derives the board row and its counters from a detail", () => {
    const row = taskListItemFromDetail(detail());
    expect(row.messages_count).toBe(2);
    expect(row.attachments_count).toBe(2);
    expect("description" in row).toBe(false);
    expect("messages" in row).toBe(false);
  });

  it("upserts a board task and removes an archived one, returning the previous row", () => {
    const client = new QueryClient();
    client.setQueryData(["tasks", "norte"], [task("a"), task("b", { due_date: "2026-12-01" })]);
    const before = applyTaskDetailToCache(client, "norte", detail({ title: "Changed", status: "revision" }));
    expect(before?.status).toBe("pendiente");
    expect(client.getQueryData<TaskListItem[]>(["tasks", "norte"])?.[0]).toMatchObject({ id: "a", title: "Changed", status: "revision" });

    applyTaskDetailToCache(client, "norte", detail({ status: "finalizado" }));
    expect(client.getQueryData<TaskListItem[]>(["tasks", "norte"])?.map((item) => item.id)).toEqual(["b"]);
  });

  it("adds a new task in order", () => {
    const client = new QueryClient();
    client.setQueryData(["tasks", "norte"], [task("b", { due_date: "2026-12-01" })]);
    applyTaskDetailToCache(client, "norte", detail({ id: "new", due_date: "2026-11-02" }));
    expect(client.getQueryData<TaskListItem[]>(["tasks", "norte"])?.map((item) => item.id)).toEqual(["new", "b"]);
  });
});
