import { describe, expect, it } from "vitest";
import type { TaskListItem } from "@/lib/api";
import { bellAriaLabel, formatBadgeCount, taskAlertContext } from "@/components/notifications/task-alert-helpers";

describe("formatBadgeCount", () => {
  it("shows the number up to 99 and caps it at 99+", () => {
    expect(formatBadgeCount(1)).toBe("1");
    expect(formatBadgeCount(99)).toBe("99");
    expect(formatBadgeCount(100)).toBe("99+");
  });
});

describe("bellAriaLabel", () => {
  it("names the real unread count, uncapped", () => {
    expect(bellAriaLabel(0)).toBe("Notificaciones");
    expect(bellAriaLabel(3)).toBe("Notificaciones, 3 sin leer");
    expect(bellAriaLabel(140)).toBe("Notificaciones, 140 sin leer");
  });
});

describe("taskAlertContext", () => {
  const base = { clients: null, policies: null } as unknown as TaskListItem;

  it("joins client and policy, falling back to the policy's client", () => {
    expect(taskAlertContext({ ...base, clients: { id: "c", full_name: "Ana Pérez" } })).toBe("Ana Pérez");
    expect(
      taskAlertContext({
        ...base,
        policies: {
          id: "p",
          policy_number: "123",
          branch: "Automotores",
          vehicle_plate: null,
          clients: { id: "c", full_name: "Juan Gómez" }
        }
      })
    ).toBe("Juan Gómez · Póliza 123");
  });

  it("is empty when the task is not linked to anything", () => {
    expect(taskAlertContext(base)).toBe("");
  });
});
