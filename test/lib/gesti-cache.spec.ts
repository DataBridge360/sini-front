import { describe, expect, it } from "vitest";
import {
  gestiCacheScope,
  gestiQueryKeys,
  isCacheFresh,
  recallOpenChat,
  rememberOpenChat
} from "@/lib/gesti-cache";

describe("gesti cache scope", () => {
  it("separates users and organizations", () => {
    expect(gestiCacheScope("user-a", "org-1")).not.toBe(gestiCacheScope("user-b", "org-1"));
    expect(gestiCacheScope("user-a", "org-1")).not.toBe(gestiCacheScope("user-a", "org-2"));
    expect(gestiCacheScope("user-a", undefined)).toBe("user-a:none");
  });

  it("nests every key under the scope so one call can drop them all", () => {
    const scope = gestiCacheScope("user-a", "org-1");
    const all = gestiQueryKeys.all(scope);
    expect(gestiQueryKeys.list(scope).slice(0, all.length)).toEqual(all);
    expect(gestiQueryKeys.chat(scope, "chat-1").slice(0, all.length)).toEqual(all);
    expect(gestiQueryKeys.chat(scope, "chat-1")).not.toEqual(gestiQueryKeys.chat(scope, "chat-2"));
  });
});

describe("isCacheFresh", () => {
  it("serves cached data until the stale time passes", () => {
    expect(isCacheFresh(1_000, 1_000, 500)).toBe(true);
    expect(isCacheFresh(1_000, 1_499, 500)).toBe(true);
    expect(isCacheFresh(1_000, 1_500, 500)).toBe(false);
  });

  it("treats data that was never fetched as stale", () => {
    expect(isCacheFresh(0, 100, 500)).toBe(false);
  });
});

describe("open chat memory", () => {
  it("remembers the open chat per scope and forgets it on a new chat", () => {
    rememberOpenChat("user-a:org-1", "chat-1");
    rememberOpenChat("user-b:org-1", "chat-9");

    expect(recallOpenChat("user-a:org-1")).toBe("chat-1");
    expect(recallOpenChat("user-b:org-1")).toBe("chat-9");
    expect(recallOpenChat("user-a:org-2")).toBeNull();

    rememberOpenChat("user-a:org-1", null);
    expect(recallOpenChat("user-a:org-1")).toBeNull();
    expect(recallOpenChat("user-b:org-1")).toBe("chat-9");
  });
});
