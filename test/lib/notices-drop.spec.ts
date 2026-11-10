import { describe, expect, it } from "vitest";
import { resolveNoticeDrop, type NoticeStatus } from "@/lib/notices";

const flow = (from: NoticeStatus, to: NoticeStatus, count = 1) => {
  const result = resolveNoticeDrop(from, to, count);
  return result.valid ? result.flow : null;
};

describe("resolveNoticeDrop, single notice", () => {
  it("maps each valid transition to its existing flow", () => {
    expect(flow("avisar", "avisado")).toBe("notify");
    expect(flow("avisado", "avisar")).toBe("revert");
    expect(flow("avisado", "pagado")).toBe("pay");
    expect(flow("pagado", "avisado")).toBe("revert-payment");
    expect(flow("avisar", "pagado")).toBe("notify-then-pay");
  });

  it("rejects paid to avisar", () => {
    expect(resolveNoticeDrop("pagado", "avisar", 1)).toEqual({ valid: false });
  });

  it("rejects dropping on the own column", () => {
    for (const status of ["avisar", "avisado", "pagado"] as const) {
      expect(resolveNoticeDrop(status, status, 1)).toEqual({ valid: false });
    }
  });

  it("rejects an empty card", () => {
    expect(resolveNoticeDrop("avisar", "avisado", 0)).toEqual({ valid: false });
  });
});

describe("resolveNoticeDrop, card with several notices", () => {
  it("notifies all pending notices when dropped on avisado", () => {
    expect(flow("avisar", "avisado", 3)).toBe("notify-all");
  });

  it("opens the detail for every other valid transition instead of a bulk action", () => {
    expect(flow("avisar", "pagado", 2)).toBe("open-detail");
    expect(flow("avisado", "avisar", 2)).toBe("open-detail");
    expect(flow("avisado", "pagado", 2)).toBe("open-detail");
    expect(flow("pagado", "avisado", 2)).toBe("open-detail");
  });

  it("keeps the invalid drops invalid", () => {
    expect(resolveNoticeDrop("pagado", "avisar", 2)).toEqual({ valid: false });
    expect(resolveNoticeDrop("avisado", "avisado", 2)).toEqual({ valid: false });
  });
});
