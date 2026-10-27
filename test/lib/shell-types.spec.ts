import { describe, expect, it } from "vitest";
import { getTabFromPathname, TAB_PATHS } from "@/lib/shell-types";

describe("getTabFromPathname", () => {
  it("routes /gesti to the Gesti assistant", () => {
    expect(TAB_PATHS.gesti).toBe("/gesti");
    expect(getTabFromPathname("/gesti")).toBe("gesti");
    expect(getTabFromPathname("/gesti/")).toBe("gesti");
  });

  it("keeps the existing routes", () => {
    expect(getTabFromPathname("/")).toBe("dashboard");
    expect(getTabFromPathname("/avisos")).toBe("notices");
    expect(getTabFromPathname("/no-existe")).toBeNull();
  });
});
