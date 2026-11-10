// Keeps the cached task board (["tasks", slug]) in sync with realtime events and
// with local mutations without refetching the whole list. Same design as
// lib/notices-realtime.ts: the org_change payload carries only ids, so the
// changed tasks are read again with one batched call (`GET /tasks?ids=a,b,c`),
// which returns the exact shape of the board list, and patched into the cache.
// A task that does not come back (archived, deleted) leaves the board.
//
// Three consumers read ["tasks", slug] (tasks view, dashboard feed, alerts
// bell); all derive their own order and groups from it, so patching the cache is
// enough to update them together.

import type { QueryClient } from "@tanstack/react-query";
import { apiRequest, type ApiCommonOptions, type TaskDetail, type TaskListItem } from "@/lib/api";
import type { OrgChangeEvent } from "@/lib/realtime";
import { compareTasksByDueDate, TASK_BOARD_STATUSES } from "@/lib/tasks";

// Above this many changed tasks in one flush, a full refetch is cheaper than
// patching. Must stay below the server's MAX_TASK_IDS.
export const TASK_PATCH_MAX = 15;

// Columns that are only visible inside the task detail. Without this, the
// description autosave (every 1200 ms while someone types) would refresh the
// board and the counters of the whole organization.
const TASK_DETAIL_ONLY_FIELDS = new Set(["description"]);

// Columns that can move a task between stage / assignee counters.
const STATS_FIELDS = new Set(["status", "assigned_to_user_id"]);

// Columns that can make a task enter or leave the archived list.
const ARCHIVE_FIELDS = new Set(["status", "archived_at"]);

/** An update that only touched columns shown inside the detail modal. */
export function isDetailOnlyTaskUpdate(event: OrgChangeEvent) {
  return (
    event.entity === "task" &&
    event.action === "update" &&
    Array.isArray(event.fields) &&
    event.fields.length > 0 &&
    event.fields.every((field) => TASK_DETAIL_ONLY_FIELDS.has(field))
  );
}

/** The task an event is about, or null when the payload does not identify one. */
export function taskIdOfEvent(event: OrgChangeEvent): string | null {
  // For a message or an attachment, parent_id is the id of its task.
  const id = event.entity === "task" ? event.entity_id : event.entity === "task_message" || event.entity === "task_attachment" ? event.parent_id : null;
  return typeof id === "string" && id !== "" ? id : null;
}

export type TaskSyncPlan = {
  /** Tasks to read again (inserted, updated, or whose messages or files changed). */
  fetchIds: string[];
  /** Tasks that were hard deleted: dropped without a request. */
  removeIds: string[];
  /** Something could not be patched, or the batch is too big: refetch the board. */
  invalidate: boolean;
  /** Stage / assignee counters (`task-stats`) may have changed. */
  invalidateStats: boolean;
  /** The paginated archived list (`tasks-archived`) may have changed. */
  invalidateArchived: boolean;
};

type Change = {
  kind: "fetch" | "remove";
  stats: boolean;
  // Archived list impact that does not depend on whether the task is on the board.
  archived: boolean;
  // Updates and deletes of a task the board does not hold may touch an archived one.
  archivedIfOffBoard: boolean;
};

/** Collects the task events of one debounce window. */
export class TaskSyncBatch {
  private readonly changes = new Map<string, Change>();
  private invalidateAll = false;

  /** False when the event is not about tasks at all. */
  add(event: OrgChangeEvent): boolean {
    if (event.entity !== "task" && event.entity !== "task_message" && event.entity !== "task_attachment") return false;
    // Writing the description does not move the board: the open detail refreshes itself.
    if (isDetailOnlyTaskUpdate(event)) return true;

    const id = taskIdOfEvent(event);
    if (!id) {
      this.invalidateAll = true;
      return true;
    }

    const change: Change = { kind: "fetch", stats: false, archived: false, archivedIfOffBoard: false };
    if (event.entity === "task") {
      if (event.action === "insert") {
        // A task is never born archived, but it does change the counters.
        change.stats = true;
      } else if (event.action === "delete") {
        change.kind = "remove";
        change.stats = true;
        change.archivedIfOffBoard = true;
      } else {
        const fields = event.fields;
        const known = Array.isArray(fields) && fields.length > 0;
        change.stats = !known || fields.some((field) => STATS_FIELDS.has(field));
        change.archived = !known || fields.some((field) => ARCHIVE_FIELDS.has(field));
        // Any other edit of a task the board does not hold may be an archived task.
        change.archivedIfOffBoard = true;
      }
    }

    const previous = this.changes.get(id);
    if (previous) {
      // Removal is final (a deleted task fires events for its messages too);
      // otherwise merge what each event can affect.
      change.kind = previous.kind === "remove" ? "remove" : change.kind;
      change.stats ||= previous.stats;
      change.archived ||= previous.archived;
      change.archivedIfOffBoard ||= previous.archivedIfOffBoard;
    }
    this.changes.set(id, change);
    return true;
  }

  get isEmpty() {
    return this.changes.size === 0 && !this.invalidateAll;
  }

  /**
   * Returns what to apply and resets the batch. `isOnBoard` tells whether the
   * cached board holds a task: an edit of a task that is on the board cannot
   * touch the archived list.
   */
  drain(isOnBoard: (id: string) => boolean = () => false): TaskSyncPlan {
    const fetchIds: string[] = [];
    const removeIds: string[] = [];
    let stats = this.invalidateAll;
    let archived = this.invalidateAll;
    for (const [id, change] of this.changes) {
      (change.kind === "fetch" ? fetchIds : removeIds).push(id);
      stats ||= change.stats;
      archived ||= change.archived || (change.archivedIfOffBoard && !isOnBoard(id));
    }
    const plan: TaskSyncPlan = {
      fetchIds,
      removeIds,
      invalidate: this.invalidateAll || fetchIds.length > TASK_PATCH_MAX,
      invalidateStats: stats,
      invalidateArchived: archived
    };
    this.changes.clear();
    this.invalidateAll = false;
    return plan;
  }
}

/**
 * The board after applying a sync: `fetched` replace or add, `requestedIds`
 * that were not returned are gone, `removeIds` are dropped. Keeps the server
 * order (due date, then creation) and returns the same array when nothing
 * changed.
 */
export function applyTaskSync(
  list: TaskListItem[],
  {
    fetched,
    requestedIds = [],
    removeIds = []
  }: { fetched: TaskListItem[]; requestedIds?: string[]; removeIds?: string[] }
): TaskListItem[] {
  const fetchedById = new Map(fetched.map((task) => [task.id, task]));
  const dropped = new Set([...removeIds, ...requestedIds.filter((id) => !fetchedById.has(id))]);

  let changed = false;
  let needsSort = false;
  const next: TaskListItem[] = [];
  for (const task of list) {
    if (dropped.has(task.id)) {
      changed = true;
      continue;
    }
    const fresh = fetchedById.get(task.id);
    if (fresh) {
      fetchedById.delete(task.id);
      if (JSON.stringify(fresh) !== JSON.stringify(task)) changed = true;
      if (fresh.due_date !== task.due_date || fresh.created_at !== task.created_at) needsSort = true;
      next.push(fresh);
    } else {
      next.push(task);
    }
  }
  // What is left was not on the board: new (or unarchived) tasks.
  for (const task of fetchedById.values()) {
    next.push(task);
    changed = true;
    needsSort = true;
  }
  if (!changed) return list;
  return needsSort ? next.sort(compareTasksByDueDate) : next;
}

// --- Local changes -------------------------------------------------------------
// A local optimistic change (dragging a card to another column) must not be
// undone by a realtime patch that reads the server before it confirms the move.
// While a task has a local change in flight, patches for it are held back; when
// the change settles, a held task is read again once, so whatever happened
// meanwhile is not lost.

const localChanges = new Map<string, { inFlight: number; held: boolean }>();

export function beginLocalTaskChange(id: string) {
  const entry = localChanges.get(id);
  if (entry) entry.inFlight += 1;
  else localChanges.set(id, { inFlight: 1, held: false });
}

/** Settles one local change. True when a realtime patch for the task was held back meanwhile. */
export function endLocalTaskChange(id: string): boolean {
  const entry = localChanges.get(id);
  if (!entry) return false;
  entry.inFlight -= 1;
  if (entry.inFlight > 0) return false;
  localChanges.delete(id);
  return entry.held;
}

export function isLocalTaskChangePending(id: string) {
  return localChanges.has(id);
}

function holdIfLocal(id: string) {
  const entry = localChanges.get(id);
  if (!entry) return false;
  entry.held = true;
  return true;
}

// --- Cache plumbing ------------------------------------------------------------

export function tasksByIdsPath(ids: string[]) {
  return `/tasks?ids=${ids.join(",")}`;
}

export type TasksFetcher = (ids: string[]) => Promise<TaskListItem[]>;

export function createTasksFetcher(scope: ApiCommonOptions): TasksFetcher {
  return (ids) => apiRequest<TaskListItem[]>(tasksByIdsPath(ids), scope);
}

const tasksKey = (slug: string) => ["tasks", slug];

/** True when the cached board holds the task. */
export function isTaskOnBoard(queryClient: QueryClient, slug: string, id: string) {
  return Boolean(queryClient.getQueryData<TaskListItem[]>(tasksKey(slug))?.some((task) => task.id === id));
}

/** Writes removals into the cached board (no-op if the board was never loaded). */
export function removeTasksFromCache(queryClient: QueryClient, slug: string, removeIds: string[]) {
  const ids = removeIds.filter((id) => !holdIfLocal(id));
  if (ids.length === 0) return;
  queryClient.setQueryData<TaskListItem[]>(tasksKey(slug), (prev) =>
    prev ? applyTaskSync(prev, { fetched: [], removeIds: ids }) : prev
  );
}

/**
 * Reads `ids` once and patches the cached board. If the read fails, the board is
 * refetched as a whole so the screen never keeps stale data. Returns whether the
 * targeted patch worked.
 */
export async function syncTasksByIds(
  queryClient: QueryClient,
  slug: string,
  ids: string[],
  fetcher: TasksFetcher
): Promise<boolean> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return true;
  try {
    const fetched = await fetcher(unique);
    // Tasks with a local change in flight keep what the user just did; they are
    // read again once that change settles.
    const free = unique.filter((id) => !holdIfLocal(id));
    const freeSet = new Set(free);
    queryClient.setQueryData<TaskListItem[]>(tasksKey(slug), (prev) =>
      prev
        ? applyTaskSync(prev, {
            fetched: fetched.filter((task) => freeSet.has(task.id)),
            requestedIds: free
          })
        : prev
    );
    return true;
  } catch {
    await queryClient.invalidateQueries({ queryKey: tasksKey(slug) });
    return false;
  }
}

/** Applies one drained plan: counters, then removals and one batched read, or a full refetch. */
export async function applyTaskSyncPlan(
  queryClient: QueryClient,
  slug: string,
  plan: TaskSyncPlan,
  fetcher: TasksFetcher
) {
  // Only active queries refetch, so the archived list costs nothing when closed.
  if (plan.invalidateStats) void queryClient.invalidateQueries({ queryKey: ["task-stats", slug] });
  if (plan.invalidateArchived) void queryClient.invalidateQueries({ queryKey: ["tasks-archived", slug] });

  if (plan.invalidate) {
    await queryClient.invalidateQueries({ queryKey: tasksKey(slug) });
    return;
  }
  removeTasksFromCache(queryClient, slug, plan.removeIds);
  await syncTasksByIds(queryClient, slug, plan.fetchIds, fetcher);
}

/** The board row of a task detail the server just returned from a mutation. */
export function taskListItemFromDetail(detail: TaskDetail, previous?: TaskListItem): TaskListItem {
  // Message-linked files live inside their message; `attachments` holds the rest.
  const messageFiles = (detail.messages ?? []).reduce((sum, message) => sum + (message.attachments?.length ?? 0), 0);
  // The detail is a superset of the row: drop what the board never carries.
  const { description: _description, messages, attachments, ...row } = detail;
  void _description;
  return {
    ...row,
    messages_count: messages ? messages.length : (previous?.messages_count ?? 0),
    attachments_count: messages && attachments ? attachments.length + messageFiles : (previous?.attachments_count ?? 0)
  };
}

/**
 * Puts a mutation's response into the board: upsert while it is a board task,
 * removal once it is archived. Returns what the cached row looked like before, so
 * the caller can tell whether a counter-affecting field changed.
 */
export function applyTaskDetailToCache(queryClient: QueryClient, slug: string, detail: TaskDetail) {
  const previous = queryClient.getQueryData<TaskListItem[]>(tasksKey(slug))?.find((task) => task.id === detail.id);
  const onBoard = (TASK_BOARD_STATUSES as readonly string[]).includes(detail.status);
  queryClient.setQueryData<TaskListItem[]>(tasksKey(slug), (prev) => {
    if (!prev) return prev;
    return onBoard
      ? applyTaskSync(prev, { fetched: [taskListItemFromDetail(detail, previous)] })
      : applyTaskSync(prev, { fetched: [], removeIds: [detail.id] });
  });
  return previous;
}
