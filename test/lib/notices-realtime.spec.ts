import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { Notice } from "@/lib/api";
import { describeNoticeAlreadyHandled } from "@/lib/notices";
import {
  applyNoticeSync,
  applyNoticeSyncPlan,
  NOTICE_PATCH_MAX,
  NoticeSyncBatch,
  noticeIdOfEvent,
  noticesByIdsPath,
  syncNoticesByIds
} from "@/lib/notices-realtime";
import { queryKeysForEvent, type OrgChangeEvent } from "@/lib/realtime";

function notice(id: string, overrides: Partial<Notice> = {}): Notice {
  return {
    id,
    due_date: "2026-11-10",
    status: "avisar",
    paid_interval_months: null,
    notified_at: null,
    payment_processed_at: null,
    notified_by: null,
    payment_processed_by: null,
    notes: [],
    ...overrides
  };
}

const event = (overrides: Partial<OrgChangeEvent>): OrgChangeEvent => ({
  entity: "policy_notice",
  entity_id: "n1",
  action: "update",
  organization_id: "org",
  ...overrides
});

describe("noticeIdOfEvent", () => {
  it("uses entity_id for a notice and parent_id for a note", () => {
    expect(noticeIdOfEvent(event({}))).toBe("n1");
    expect(noticeIdOfEvent(event({ entity: "notice_note", entity_id: "note1", parent_id: "n2" }))).toBe("n2");
    expect(noticeIdOfEvent(event({ entity: "notice_note", entity_id: "note1" }))).toBeNull();
    expect(noticeIdOfEvent(event({ entity: "task" }))).toBeNull();
  });
});

describe("queryKeysForEvent for notices", () => {
  it("does not invalidate the notices list when the event identifies the notice", () => {
    expect(queryKeysForEvent(event({ parent_id: "p1" }), "norte")).toEqual([["policy-notices", "p1"]]);
    expect(queryKeysForEvent(event({ entity: "notice_note", entity_id: "x", parent_id: "n1" }), "norte")).toEqual([
      ["policy-notices"]
    ]);
  });

  it("falls back to the whole list when there is no id", () => {
    expect(queryKeysForEvent(event({ entity_id: "" }), "norte")[0]).toEqual(["notices", "norte"]);
  });
});

describe("NoticeSyncBatch", () => {
  it("ignores events that are not about notices", () => {
    const batch = new NoticeSyncBatch();
    expect(batch.add(event({ entity: "task" }))).toBe(false);
    expect(batch.isEmpty).toBe(true);
  });

  it("collapses a burst on one notice into a single read", () => {
    const batch = new NoticeSyncBatch();
    batch.add(event({}));
    batch.add(event({ entity: "notice_note", entity_id: "note", parent_id: "n1" }));
    batch.add(event({ entity_id: "n2", action: "insert" }));
    expect(batch.drain()).toEqual({ fetchIds: ["n1", "n2"], removeIds: [], invalidate: false });
    expect(batch.isEmpty).toBe(true);
  });

  it("removes hard-deleted notices without a request, but a deleted note only rereads its notice", () => {
    const batch = new NoticeSyncBatch();
    batch.add(event({ entity_id: "n1", action: "delete" }));
    batch.add(event({ entity: "notice_note", entity_id: "note", parent_id: "n2", action: "delete" }));
    expect(batch.drain()).toEqual({ fetchIds: ["n2"], removeIds: ["n1"], invalidate: false });
  });

  it("falls back to a full refetch above the threshold or without an id", () => {
    const big = new NoticeSyncBatch();
    for (let index = 0; index <= NOTICE_PATCH_MAX; index += 1) big.add(event({ entity_id: `n${index}` }));
    expect(big.drain().invalidate).toBe(true);

    const noId = new NoticeSyncBatch();
    noId.add(event({ entity: "notice_note", entity_id: "note" }));
    expect(noId.drain().invalidate).toBe(true);
  });
});

describe("applyNoticeSync", () => {
  const list = [notice("a", { due_date: "2026-11-01" }), notice("b", { due_date: "2026-11-05" })];

  it("replaces a changed notice in place", () => {
    const next = applyNoticeSync(list, { fetched: [notice("b", { due_date: "2026-11-05", status: "avisado" })], requestedIds: ["b"] });
    expect(next.map((n) => [n.id, n.status])).toEqual([["a", "avisar"], ["b", "avisado"]]);
  });

  it("adds a new notice in due-date order and drops one that was not returned", () => {
    const next = applyNoticeSync(list, {
      fetched: [notice("c", { due_date: "2026-11-03" })],
      requestedIds: ["c", "a"]
    });
    expect(next.map((n) => n.id)).toEqual(["c", "b"]);
  });

  it("drops removed ids and returns the same list when nothing changed", () => {
    expect(applyNoticeSync(list, { fetched: [], removeIds: ["a"] }).map((n) => n.id)).toEqual(["b"]);
    expect(applyNoticeSync(list, { fetched: [list[0]!], requestedIds: ["a"] })).toBe(list);
  });
});

describe("syncNoticesByIds", () => {
  const key = ["notices", "norte"];
  const setup = (data: Notice[] | undefined) => {
    const client = new QueryClient();
    if (data) client.setQueryData(key, data);
    return client;
  };

  it("patches the cache with one read and never refetches the list", async () => {
    const client = setup([notice("a"), notice("b")]);
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const fetcher = vi.fn(async () => [notice("a", { status: "pagado" })]);
    await applyNoticeSyncPlan(client, "norte", { fetchIds: ["a", "b"], removeIds: [], invalidate: false }, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(["a", "b"]);
    expect(client.getQueryData<Notice[]>(key)?.map((n) => [n.id, n.status])).toEqual([["a", "pagado"]]);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("invalidates the list when the read fails", async () => {
    const client = setup([notice("a")]);
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const ok = await syncNoticesByIds(client, "norte", ["a"], async () => {
      throw new Error("boom");
    });
    expect(ok).toBe(false);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: key });
  });

  it("invalidates without reading when the plan asks for a full refetch, and leaves an unloaded cache alone", async () => {
    const client = setup(undefined);
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const fetcher = vi.fn(async () => [notice("a")]);
    await applyNoticeSyncPlan(client, "norte", { fetchIds: [], removeIds: [], invalidate: true }, fetcher);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(fetcher).not.toHaveBeenCalled();
    await syncNoticesByIds(client, "norte", ["a"], fetcher);
    expect(client.getQueryData(key)).toBeUndefined();
  });

  it("builds the batched read path", () => {
    expect(noticesByIdsPath(["a", "b"])).toBe("/notices?ids=a,b");
  });
});

describe("describeNoticeAlreadyHandled", () => {
  it("says who and when for notified and paid notices, and nothing for a pending one", () => {
    expect(describeNoticeAlreadyHandled(notice("a"), "u1")).toBeNull();
    const notified = notice("a", { status: "avisado", notified_by: { id: "u2", full_name: "Ana" }, notified_at: "2026-11-10T17:30:00Z" });
    expect(describeNoticeAlreadyHandled(notified, "u1")).toMatch(/^Ya fue avisado por Ana el 10\/11\/2026/);
    expect(describeNoticeAlreadyHandled(notified, "u2")).toMatch(/^Ya fue avisado por vos/);
    const paid = notice("a", { status: "pagado", payment_processed_by: null, payment_processed_at: null });
    expect(describeNoticeAlreadyHandled(paid, "u1")).toBe("Ya fue pagado por otra persona.");
  });
});
