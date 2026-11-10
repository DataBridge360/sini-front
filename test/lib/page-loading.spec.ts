import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDelayedFlag, createPageLoadingStore, pickLoadingText } from "@/lib/page-loading";

describe("page loading store", () => {
  it("keeps one entry per loader and reports the most recent text", () => {
    const store = createPageLoadingStore();
    store.register("a", "Cargando avisos");
    store.register("b", "Cargando tareas");
    expect(store.getSnapshot().entries).toHaveLength(2);
    expect(pickLoadingText(store.getSnapshot().entries)).toBe("Cargando tareas");
    store.release("b");
    expect(pickLoadingText(store.getSnapshot().entries)).toBe("Cargando avisos");
  });

  it("releases every loader so the overlay never stays stuck", () => {
    const store = createPageLoadingStore();
    store.register("a", "x");
    store.register("b", "y");
    store.release("a");
    store.release("b");
    store.release("b");
    expect(store.getSnapshot().entries).toEqual([]);
    expect(pickLoadingText(store.getSnapshot().entries)).toBe("");
  });

  it("updates text in place and ignores identical registrations", () => {
    const store = createPageLoadingStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.register("a", "uno");
    store.register("a", "uno");
    expect(listener).toHaveBeenCalledTimes(1);
    store.register("a", "dos");
    expect(store.getSnapshot().entries).toEqual([{ id: "a", text: "dos" }]);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("counts mounted hosts and unsubscribes listeners", () => {
    const store = createPageLoadingStore();
    const listener = vi.fn();
    const off = store.subscribe(listener);
    const unmount = store.mountHost();
    expect(store.getSnapshot().hosts).toBe(1);
    unmount();
    expect(store.getSnapshot().hosts).toBe(0);
    off();
    store.register("a", "x");
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe("createDelayedFlag", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("does not show for a load shorter than the delay", () => {
    const onChange = vi.fn();
    const flag = createDelayedFlag({ showAfterMs: 120, hideAfterMs: 100 }, onChange);
    flag.set(true);
    vi.advanceTimersByTime(80);
    flag.set(false);
    vi.advanceTimersByTime(500);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows after the delay and hides after its own delay", () => {
    const onChange = vi.fn();
    const flag = createDelayedFlag({ showAfterMs: 120, hideAfterMs: 100 }, onChange);
    flag.set(true);
    vi.advanceTimersByTime(120);
    expect(onChange).toHaveBeenLastCalledWith(true);
    flag.set(false);
    vi.advanceTimersByTime(100);
    expect(onChange).toHaveBeenLastCalledWith(false);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("bridges a hand-over between two loaders without hiding", () => {
    const onChange = vi.fn();
    const flag = createDelayedFlag({ showAfterMs: 120, hideAfterMs: 100 }, onChange);
    flag.set(true);
    vi.advanceTimersByTime(120);
    flag.set(false);
    vi.advanceTimersByTime(40);
    flag.set(true);
    vi.advanceTimersByTime(1000);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("stops pending timers on dispose", () => {
    const onChange = vi.fn();
    const flag = createDelayedFlag({ showAfterMs: 120, hideAfterMs: 100 }, onChange);
    flag.set(true);
    flag.dispose();
    vi.advanceTimersByTime(500);
    expect(onChange).not.toHaveBeenCalled();
  });
});
