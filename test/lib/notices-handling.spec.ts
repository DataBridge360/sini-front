import { describe, expect, it } from "vitest";
import type { Notice } from "@/lib/api";
import {
  describeHandlingAge,
  describeNoticeHandlingLine,
  formatHandlingWhen,
  noticeActionsFor,
  noticeContactOf,
  pendingNotices,
  RECENT_HANDLING_WINDOW_MS,
  recentHandlingByOther,
  recentHandlingDeadline
} from "@/lib/notices";

const NOW = new Date(2026, 10, 10, 15, 30, 0).getTime();
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const ana = { id: "u-ana", full_name: "Ana Pérez" };
const me = { id: "u-me", full_name: "Lucas Segura" };

function notice(overrides: Partial<Notice> = {}): Notice {
  return {
    id: "n1",
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

const notifiedBy = (by: typeof ana, ms: number) =>
  notice({ status: "avisado", notified_by: by, notified_at: ago(ms) });

describe("noticeContactOf", () => {
  it("trims values and omits the missing row", () => {
    expect(noticeContactOf({ phone: " 299 412-7785 ", email: "  " })).toEqual({ phone: "299 412-7785", email: null });
    expect(noticeContactOf({ phone: null, email: "a@b.com" })).toEqual({ phone: null, email: "a@b.com" });
  });

  it("returns null when the client has neither phone nor email", () => {
    expect(noticeContactOf({ phone: "", email: null })).toBeNull();
    expect(noticeContactOf(null)).toBeNull();
    expect(noticeContactOf(undefined)).toBeNull();
  });
});

describe("noticeActionsFor", () => {
  it("offers the strict flow with the mockup copy", () => {
    expect(noticeActionsFor("avisar")).toEqual([{ kind: "notify", label: "Marcar avisado" }]);
    expect(noticeActionsFor("avisado")).toEqual([
      { kind: "revert", label: "Volver a avisar" },
      { kind: "pay", label: "Registrar pago" }
    ]);
    expect(noticeActionsFor("pagado")).toEqual([{ kind: "revert", label: "Revertir pago" }]);
  });
});

describe("pendingNotices", () => {
  it("keeps only notices that still have to be contacted", () => {
    const pending = notice({ id: "a" });
    const done = notice({ id: "b", status: "avisado" });
    expect(pendingNotices([pending, done])).toEqual([pending]);
    expect(pendingNotices([done])).toEqual([]);
  });
});

describe("recentHandlingByOther", () => {
  it("detects another user who marked the notice within two minutes", () => {
    const result = recentHandlingByOther(notifiedBy(ana, 60_000), me.id, NOW);
    expect(result).toMatchObject({ kind: "notified", by: ana });
  });

  it("never reports the current user's own action", () => {
    expect(recentHandlingByOther(notifiedBy(me, 5_000), me.id, NOW)).toBeNull();
  });

  it("falls back to null once the window has passed", () => {
    expect(recentHandlingByOther(notifiedBy(ana, RECENT_HANDLING_WINDOW_MS - 1), me.id, NOW)).not.toBeNull();
    expect(recentHandlingByOther(notifiedBy(ana, RECENT_HANDLING_WINDOW_MS), me.id, NOW)).toBeNull();
  });

  it("is null for pending notices, unknown current user and missing audit data", () => {
    expect(recentHandlingByOther(notice(), me.id, NOW)).toBeNull();
    expect(recentHandlingByOther(notifiedBy(ana, 1_000), null, NOW)).toBeNull();
    expect(recentHandlingByOther(notice({ status: "avisado" }), me.id, NOW)).toBeNull();
  });

  it("uses the payment audit for paid notices", () => {
    const paid = notice({
      status: "pagado",
      notified_by: me,
      notified_at: ago(600_000),
      payment_processed_by: ana,
      payment_processed_at: ago(30_000)
    });
    expect(recentHandlingByOther(paid, me.id, NOW)).toMatchObject({ kind: "paid", by: ana });
  });

  it("treats a server timestamp slightly ahead of the local clock as recent", () => {
    expect(recentHandlingByOther(notifiedBy(ana, -3_000), me.id, NOW)).not.toBeNull();
  });
});

describe("recentHandlingDeadline", () => {
  it("returns the earliest moment a banner stops being recent", () => {
    const first = notifiedBy(ana, 90_000);
    const second = { ...notifiedBy(ana, 10_000), id: "n2" };
    expect(recentHandlingDeadline([second, first], me.id, NOW)).toBe(NOW - 90_000 + RECENT_HANDLING_WINDOW_MS);
  });

  it("is null when nothing is recent", () => {
    expect(recentHandlingDeadline([notifiedBy(ana, 600_000), notifiedBy(me, 1_000)], me.id, NOW)).toBeNull();
    expect(recentHandlingDeadline([], me.id, NOW)).toBeNull();
  });
});

describe("describeHandlingAge", () => {
  it("speaks in seconds and minutes", () => {
    expect(describeHandlingAge(NOW - 20_000, NOW)).toBe("hace unos segundos");
    expect(describeHandlingAge(NOW - 60_000, NOW)).toBe("hace 1 minuto");
    expect(describeHandlingAge(NOW - 119_000, NOW)).toBe("hace 1 minuto");
    expect(describeHandlingAge(NOW - 120_000, NOW)).toBe("hace 2 minutos");
  });
});

describe("formatHandlingWhen", () => {
  it("uses today, yesterday and short dates", () => {
    expect(formatHandlingWhen(new Date(2026, 10, 10, 9, 5).toISOString(), NOW)).toBe("hoy 09:05");
    expect(formatHandlingWhen(new Date(2026, 10, 9, 16, 20).toISOString(), NOW)).toBe("ayer 16:20");
    expect(formatHandlingWhen(new Date(2026, 10, 5, 11, 5).toISOString(), NOW)).toBe("05/11 11:05");
    expect(formatHandlingWhen(new Date(2025, 11, 31, 8, 0).toISOString(), NOW)).toBe("31/12/2025 08:00");
    expect(formatHandlingWhen("nope", NOW)).toBe("");
  });
});

describe("describeNoticeHandlingLine", () => {
  it("names who notified and says 'vos' for the current user", () => {
    const yesterday = new Date(2026, 10, 9, 16, 20).toISOString();
    const theirs = notice({ status: "avisado", notified_by: ana, notified_at: yesterday });
    expect(describeNoticeHandlingLine(theirs, me.id, NOW)).toEqual({
      kind: "notified",
      text: "Avisado por Ana Pérez · ayer 16:20"
    });
    const mine = notice({ status: "avisado", notified_by: me, notified_at: yesterday });
    expect(describeNoticeHandlingLine(mine, me.id, NOW)?.text).toBe("Avisado por vos · ayer 16:20");
  });

  it("describes the payment for paid notices and nothing for pending ones", () => {
    const paid = notice({
      status: "pagado",
      payment_processed_by: ana,
      payment_processed_at: new Date(2026, 10, 10, 11, 5).toISOString()
    });
    expect(describeNoticeHandlingLine(paid, me.id, NOW)?.text).toBe("Pago registrado por Ana Pérez · hoy 11:05");
    expect(describeNoticeHandlingLine(notice(), me.id, NOW)).toBeNull();
  });
});
