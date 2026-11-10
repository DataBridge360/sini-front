// Keeps the cached notices list in sync with realtime events without refetching
// the whole list. The org_change payload carries only the entity id (never the
// row), so a change to a notice or to one of its notes is resolved with a single
// batched read of just the changed notices (`GET /notices?ids=a,b,c`), which
// returns the exact shape the list uses. A notice that does not come back (soft
// deleted) is dropped from the cache.

import type { QueryClient } from "@tanstack/react-query";
import { apiRequest, type ApiCommonOptions, type Notice } from "@/lib/api";
import type { OrgChangeEvent } from "@/lib/realtime";

// Above this many changed notices in one flush, a full refetch is cheaper than
// patching. Must stay below the server's MAX_NOTICE_IDS.
export const NOTICE_PATCH_MAX = 15;

/** The notice an event is about, or null when the payload does not identify one. */
export function noticeIdOfEvent(event: OrgChangeEvent): string | null {
  // For a note, parent_id is the id of its notice.
  const id = event.entity === "policy_notice" ? event.entity_id : event.entity === "notice_note" ? event.parent_id : null;
  return typeof id === "string" && id !== "" ? id : null;
}

export type NoticeSyncPlan = {
  /** Notices to read again (inserted, updated, or whose notes changed). */
  fetchIds: string[];
  /** Notices that were hard deleted: dropped without a request. */
  removeIds: string[];
  /** Something could not be patched, or the batch is too big: refetch the list. */
  invalidate: boolean;
};

/** Collects the notice events of one debounce window. */
export class NoticeSyncBatch {
  private readonly changes = new Map<string, "fetch" | "remove">();
  private invalidateAll = false;

  /** False when the event is not about notices at all. */
  add(event: OrgChangeEvent): boolean {
    if (event.entity !== "policy_notice" && event.entity !== "notice_note") return false;
    const id = noticeIdOfEvent(event);
    if (!id) {
      this.invalidateAll = true;
      return true;
    }
    // A hard-deleted notice is gone; a deleted note only changes its notice.
    const removed = event.entity === "policy_notice" && event.action === "delete";
    this.changes.set(id, removed ? "remove" : "fetch");
    return true;
  }

  get isEmpty() {
    return this.changes.size === 0 && !this.invalidateAll;
  }

  /** Returns what to apply and resets the batch. */
  drain(): NoticeSyncPlan {
    const fetchIds: string[] = [];
    const removeIds: string[] = [];
    for (const [id, kind] of this.changes) (kind === "fetch" ? fetchIds : removeIds).push(id);
    const plan = {
      fetchIds,
      removeIds,
      invalidate: this.invalidateAll || fetchIds.length > NOTICE_PATCH_MAX
    };
    this.changes.clear();
    this.invalidateAll = false;
    return plan;
  }
}

function compareNotices(a: Notice, b: Notice) {
  // Same order as the server: due date, then id.
  if (a.due_date !== b.due_date) return a.due_date < b.due_date ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * The list after applying a sync: `fetched` replace or add, `requestedIds` that
 * were not returned are gone, `removeIds` are dropped. Returns the same array
 * when nothing changed.
 */
export function applyNoticeSync(
  list: Notice[],
  { fetched, requestedIds = [], removeIds = [] }: { fetched: Notice[]; requestedIds?: string[]; removeIds?: string[] }
): Notice[] {
  const fetchedById = new Map(fetched.map((notice) => [notice.id, notice]));
  const dropped = new Set([...removeIds, ...requestedIds.filter((id) => !fetchedById.has(id))]);

  let changed = false;
  const next: Notice[] = [];
  let needsSort = false;
  for (const notice of list) {
    if (dropped.has(notice.id)) {
      changed = true;
      continue;
    }
    const fresh = fetchedById.get(notice.id);
    if (fresh) {
      fetchedById.delete(notice.id);
      if (JSON.stringify(fresh) !== JSON.stringify(notice)) changed = true;
      if (fresh.due_date !== notice.due_date) needsSort = true;
      next.push(fresh);
    } else {
      next.push(notice);
    }
  }
  // What is left was not in the list: new notices.
  for (const notice of fetchedById.values()) {
    next.push(notice);
    changed = true;
    needsSort = true;
  }
  if (!changed) return list;
  return needsSort ? next.sort(compareNotices) : next;
}

export function noticesByIdsPath(ids: string[]) {
  return `/notices?ids=${ids.join(",")}`;
}

export type NoticesFetcher = (ids: string[]) => Promise<Notice[]>;

export function createNoticesFetcher(scope: ApiCommonOptions): NoticesFetcher {
  return (ids) => apiRequest<Notice[]>(noticesByIdsPath(ids), scope);
}

/** Writes the plan's removals into the cached list (no-op if the list was never loaded). */
export function removeNoticesFromCache(queryClient: QueryClient, slug: string, removeIds: string[]) {
  if (removeIds.length === 0) return;
  queryClient.setQueryData<Notice[]>(["notices", slug], (prev) =>
    prev ? applyNoticeSync(prev, { fetched: [], removeIds }) : prev
  );
}

/**
 * Reads `ids` once and patches the cached list. If the read fails, the list is
 * refetched as a whole so the screen never keeps stale data. Returns whether
 * the targeted patch worked.
 */
export async function syncNoticesByIds(
  queryClient: QueryClient,
  slug: string,
  ids: string[],
  fetcher: NoticesFetcher
): Promise<boolean> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return true;
  try {
    const fetched = await fetcher(unique);
    queryClient.setQueryData<Notice[]>(["notices", slug], (prev) =>
      prev ? applyNoticeSync(prev, { fetched, requestedIds: unique }) : prev
    );
    return true;
  } catch {
    await queryClient.invalidateQueries({ queryKey: ["notices", slug] });
    return false;
  }
}

/** Applies one drained plan: removals, then one batched read, or a full refetch. */
export async function applyNoticeSyncPlan(
  queryClient: QueryClient,
  slug: string,
  plan: NoticeSyncPlan,
  fetcher: NoticesFetcher
) {
  if (plan.invalidate) {
    await queryClient.invalidateQueries({ queryKey: ["notices", slug] });
    return;
  }
  removeNoticesFromCache(queryClient, slug, plan.removeIds);
  await syncNoticesByIds(queryClient, slug, plan.fetchIds, fetcher);
}
