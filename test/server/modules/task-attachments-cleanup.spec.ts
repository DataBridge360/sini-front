import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseService } from "@/server/core/supabase";
import {
  ORPHAN_MIN_AGE_MS,
  handleTaskAttachmentsCleanup,
  sweepOrphanedTaskAttachments
} from "@/server/modules/tasks/attachment-cleanup";

// Barrido de adjuntos huérfanos (spec S7): objetos del bucket que ninguna fila
// de task_attachments referencia y que quedaron de una subida abandonada.

const NOW = Date.UTC(2026, 9, 16, 12, 0, 0);
const OLD = new Date(NOW - ORPHAN_MIN_AGE_MS - 60_000).toISOString();
const RECENT = new Date(NOW - 60_000).toISOString();

const state = {
  objects: [] as Array<{ path: string; createdAt: string }>,
  linked: [] as string[],
  removed: [] as string[][],
  linkedQueryError: null as { message: string } | null
};

function entriesUnder(prefix: string) {
  const depth = prefix ? prefix.split("/").length : 0;
  const seen = new Map<string, { name: string; id: string | null; created_at: string | null }>();
  for (const object of state.objects) {
    const parts = object.path.split("/");
    if (prefix && parts.slice(0, depth).join("/") !== prefix) continue;
    const name = parts[depth]!;
    const isFile = parts.length === depth + 1;
    seen.set(name, isFile ? { name, id: `id-${object.path}`, created_at: object.createdAt } : { name, id: null, created_at: null });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const supabase = {
  admin: {
    from: () => ({
      select: () => ({
        in: async (_column: string, paths: string[]) =>
          state.linkedQueryError
            ? { data: null, error: state.linkedQueryError }
            : { data: state.linked.filter((path) => paths.includes(path)).map((path) => ({ storage_path: path })), error: null }
      })
    }),
    storage: {
      from: () => ({
        list: async (prefix: string, options: { limit: number; offset: number }) => ({
          data: entriesUnder(prefix).slice(options.offset, options.offset + options.limit),
          error: null
        }),
        remove: async (paths: string[]) => {
          state.removed.push(paths);
          return { data: [], error: null };
        }
      })
    }
  }
} as unknown as SupabaseService;

beforeEach(() => {
  state.objects = [];
  state.linked = [];
  state.removed = [];
  state.linkedQueryError = null;
});

describe("sweepOrphanedTaskAttachments", () => {
  it("removes only unlinked objects older than the minimum age", async () => {
    state.objects = [
      { path: "org-a/task-1/1-aaaaaaaa-orphan.png", createdAt: OLD },
      { path: "org-a/task-1/2-bbbbbbbb-linked.png", createdAt: OLD },
      { path: "org-a/task-1/3-cccccccc-uploading.png", createdAt: RECENT },
      { path: "org-b/task-2/4-dddddddd-orphan.pdf", createdAt: OLD }
    ];
    state.linked = ["org-a/task-1/2-bbbbbbbb-linked.png"];

    const result = await sweepOrphanedTaskAttachments(supabase, NOW);

    expect(result).toEqual({ scanned: 4, removed: 2 });
    expect(state.removed).toEqual([["org-a/task-1/1-aaaaaaaa-orphan.png"], ["org-b/task-2/4-dddddddd-orphan.pdf"]]);
  });

  it("pages through folders with more objects than one listing returns", async () => {
    state.objects = Array.from({ length: 250 }, (_, index) => ({
      path: `org-a/task-1/${String(index).padStart(4, "0")}-aaaaaaaa-f.png`,
      createdAt: OLD
    }));

    const result = await sweepOrphanedTaskAttachments(supabase, NOW);

    expect(result).toEqual({ scanned: 250, removed: 250 });
  });

  it("deletes nothing when it cannot tell which objects are linked", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    state.objects = [{ path: "org-a/task-1/1-aaaaaaaa-x.png", createdAt: OLD }];
    state.linkedQueryError = { message: "db down" };

    await expect(sweepOrphanedTaskAttachments(supabase, NOW)).rejects.toThrow();
    expect(state.removed).toEqual([]);
  });
});

describe("handleTaskAttachmentsCleanup", () => {
  const request = (authorization?: string) =>
    new Request("https://app.test/api/cron/task-attachments-cleanup", {
      headers: authorization ? { authorization } : {}
    });

  it("refuses to run when CRON_SECRET is not configured", async () => {
    const response = await handleTaskAttachmentsCleanup(request("Bearer x"), { secret: undefined, supabase, now: NOW });

    expect(response.status).toBe(503);
    expect(state.removed).toEqual([]);
  });

  it("rejects requests without the cron secret", async () => {
    state.objects = [{ path: "org-a/task-1/1-aaaaaaaa-x.png", createdAt: OLD }];
    const missing = await handleTaskAttachmentsCleanup(request(), { secret: "s3cret", supabase, now: NOW });
    const wrong = await handleTaskAttachmentsCleanup(request("Bearer nope"), { secret: "s3cret", supabase, now: NOW });

    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(state.removed).toEqual([]);
  });

  it("sweeps and reports when the secret matches", async () => {
    state.objects = [{ path: "org-a/task-1/1-aaaaaaaa-x.png", createdAt: OLD }];
    const response = await handleTaskAttachmentsCleanup(request("Bearer s3cret"), { secret: "s3cret", supabase, now: NOW });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ scanned: 1, removed: 1 });
  });
});
