import { describe, expect, it } from "vitest";
import {
  matchesPolicyNumber,
  policyNumberAt,
  historicNumberTitle,
  policyNumberMatch,
  previousNumbersLabel,
  previousPolicyNumbers,
  taskPolicyNumber
} from "@/lib/policy-numbers";

const policy = {
  policy_number: "C-300",
  previous_policy_numbers: [
    { number: "B-200", replaced_at: "2026-06-01T12:00:00.000Z", replaced_by_user_id: null },
    { number: "A-100", replaced_at: "2025-06-01T12:00:00.000Z", replaced_by_user_id: "u1" }
  ]
};

describe("policyNumberAt", () => {
  it("returns the number in force at the given date", () => {
    expect(policyNumberAt(policy, "2025-01-01T00:00:00Z")).toBe("A-100");
    expect(policyNumberAt(policy, "2025-12-01T00:00:00Z")).toBe("B-200");
    expect(policyNumberAt(policy, "2026-09-01T00:00:00Z")).toBe("C-300");
  });

  it("treats the replacement instant itself as already the new number", () => {
    expect(policyNumberAt(policy, "2025-06-01T12:00:00.000Z")).toBe("B-200");
  });

  it("accepts Date and epoch inputs", () => {
    expect(policyNumberAt(policy, new Date("2025-01-01T00:00:00Z"))).toBe("A-100");
    expect(policyNumberAt(policy, Date.parse("2026-09-01T00:00:00Z"))).toBe("C-300");
  });

  it("falls back to the current number without a usable date or history", () => {
    expect(policyNumberAt(policy, null)).toBe("C-300");
    expect(policyNumberAt(policy, "not a date")).toBe("C-300");
    expect(policyNumberAt({ policy_number: "X" }, "2020-01-01")).toBe("X");
    expect(policyNumberAt({ policy_number: "X", previous_policy_numbers: [] }, "2020-01-01")).toBe("X");
  });

  it("tolerates malformed history", () => {
    const messy = {
      policy_number: "X",
      previous_policy_numbers: [null, 3, {}, { number: "", replaced_at: "2026-01-01" }, { number: "Y", replaced_at: "bad" }]
    };
    expect(policyNumberAt(messy, "2020-01-01")).toBe("X");
    expect(policyNumberAt({ policy_number: "X", previous_policy_numbers: "nope" }, "2020-01-01")).toBe("X");
  });

  it("returns null without a policy", () => {
    expect(policyNumberAt(null, "2020-01-01")).toBeNull();
    expect(policyNumberAt(undefined, "2020-01-01")).toBeNull();
  });
});

describe("policyNumberMatch", () => {
  it("tells current from previous matches, ignoring case and partial text", () => {
    expect(policyNumberMatch(policy, "c-3")).toBe("current");
    expect(policyNumberMatch(policy, "b-2")).toBe("previous");
    expect(policyNumberMatch(policy, "A-100")).toBe("previous");
    expect(policyNumberMatch(policy, "zzz")).toBeNull();
  });

  it("does not match an empty search", () => {
    expect(policyNumberMatch(policy, "  ")).toBeNull();
    expect(matchesPolicyNumber(policy, "")).toBe(false);
    expect(matchesPolicyNumber(policy, "200")).toBe(true);
  });

  it("prefers the current number when both match", () => {
    expect(policyNumberMatch({ ...policy, policy_number: "B-200-X" }, "B-200")).toBe("current");
  });
});

describe("previous numbers display", () => {
  it("lists previous numbers newest first", () => {
    expect(previousPolicyNumbers(policy)).toEqual(["B-200", "A-100"]);
    expect(previousNumbersLabel(policy)).toBe("Antes: #B-200, #A-100");
  });

  it("returns nothing when there are none", () => {
    expect(previousPolicyNumbers({ policy_number: "X" })).toEqual([]);
    expect(previousNumbersLabel({ policy_number: "X" })).toBeNull();
    expect(previousNumbersLabel(null)).toBeNull();
  });
});

describe("taskPolicyNumber", () => {
  it("shows the number in force when the task was created", () => {
    const old = taskPolicyNumber({ created_at: "2025-12-01T00:00:00Z", policies: policy });
    expect(old).toEqual({ shown: "B-200", current: "C-300", isHistoric: true });
    expect(historicNumberTitle(old)).toBe("Hoy la póliza es #C-300");
  });

  it("is not historic for a task created after the last renewal or without a policy", () => {
    const recent = taskPolicyNumber({ created_at: "2026-09-01T00:00:00Z", policies: policy });
    expect(recent.isHistoric).toBe(false);
    expect(historicNumberTitle(recent)).toBeUndefined();
    expect(taskPolicyNumber({ created_at: "2026-09-01T00:00:00Z", policies: null })).toEqual({
      shown: null,
      current: null,
      isHistoric: false
    });
  });
});
