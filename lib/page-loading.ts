"use client";

// One page loader, however many modules are loading. Every page-level
// `LoadingState` registers itself here while it is mounted; the app shell owns a
// single overlay that shows while at least one loader is registered, so two
// mascots can never be visible at once. A loader releases its entry when it
// unmounts (effect cleanup), so an error, a view switch or a fast unmount never
// leaves the overlay stuck.

import { useEffect, useId, useSyncExternalStore } from "react";

export type PageLoaderEntry = { id: string; text: string };

export type PageLoadingSnapshot = {
  /** Registered loaders, oldest first. */
  entries: readonly PageLoaderEntry[];
  /** How many overlay hosts are mounted (0 means loaders must render themselves). */
  hosts: number;
};

/** One message for the overlay: the most recently registered loader's text. */
export function pickLoadingText(entries: readonly PageLoaderEntry[]): string {
  return entries.at(-1)?.text ?? "";
}

export function createPageLoadingStore() {
  let entries: PageLoaderEntry[] = [];
  let hosts = 0;
  let snapshot: PageLoadingSnapshot = { entries, hosts };
  const listeners = new Set<() => void>();

  const emit = () => {
    snapshot = { entries, hosts };
    for (const listener of listeners) listener();
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** Adds or updates a loader. A text change moves it to the "most recent" slot only when it is new. */
    register(id: string, text: string) {
      const current = entries.find((entry) => entry.id === id);
      if (!current) {
        entries = [...entries, { id, text }];
      } else if (current.text !== text) {
        entries = entries.map((entry) => (entry.id === id ? { id, text } : entry));
      } else {
        return;
      }
      emit();
    },
    release(id: string) {
      if (!entries.some((entry) => entry.id === id)) return;
      entries = entries.filter((entry) => entry.id !== id);
      emit();
    },
    mountHost() {
      hosts += 1;
      emit();
      return () => {
        hosts = Math.max(0, hosts - 1);
        emit();
      };
    }
  };
}

export const pageLoadingStore = createPageLoadingStore();

const SERVER_SNAPSHOT: PageLoadingSnapshot = { entries: [], hosts: 0 };

export function usePageLoadingSnapshot(): PageLoadingSnapshot {
  return useSyncExternalStore(pageLoadingStore.subscribe, pageLoadingStore.getSnapshot, () => SERVER_SNAPSHOT);
}

/** Registers a page loader for as long as the calling component stays mounted. */
export function useRegisterPageLoader(text: string, enabled: boolean) {
  const id = useId();
  useEffect(() => {
    if (!enabled) return;
    pageLoadingStore.register(id, text);
    return () => pageLoadingStore.release(id);
  }, [id, text, enabled]);
}

/** Marks the calling component as the overlay host while mounted. */
export function usePageLoadingHost() {
  useEffect(() => pageLoadingStore.mountHost(), []);
}

/**
 * Debounces a boolean so very fast loads never flash the overlay and a loader
 * handing over to the next one (chunk fallback, then the view's own loader)
 * reads as one continuous overlay.
 */
export function createDelayedFlag(
  { showAfterMs, hideAfterMs }: { showAfterMs: number; hideAfterMs: number },
  onChange: (visible: boolean) => void
) {
  let visible = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let target = false;

  const clear = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  return {
    set(active: boolean) {
      if (active === target) return;
      target = active;
      clear();
      if (active === visible) return;
      timer = setTimeout(
        () => {
          timer = null;
          visible = active;
          onChange(visible);
        },
        active ? showAfterMs : hideAfterMs
      );
    },
    dispose: clear
  };
}
