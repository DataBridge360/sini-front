import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser, OrganizationContext } from "@/server/core/context";
import { MemoryRateLimiter } from "@/server/core/rate-limit";
import { createApiHandler } from "@/server/core/router";
import type { SupabaseService } from "@/server/core/supabase";

const USER: AuthUser = {
  id: "user-1",
  email: "ana@example.com",
  fullName: "Ana",
  avatarUrl: null,
  platformRole: "user"
};
const ORGANIZATION: OrganizationContext = {
  id: "org-1",
  slug: "norte",
  displayName: "Norte",
  primaryColor: null,
  secondaryColor: null,
  role: "asesor"
};

// Fake query builder: every method chains and the final await yields the next queued result.
const results: Array<{ data?: unknown; error?: unknown }> = [];
const calls: Array<{ method: string; args: unknown[] }> = [];

function builder() {
  const proxy: unknown = new Proxy(
    {},
    {
      get(_target, property) {
        if (property === "then") {
          const next = results.shift() ?? { data: null, error: null };
          return (resolve: (value: unknown) => void) => resolve({ error: null, ...next });
        }
        return (...args: unknown[]) => {
          calls.push({ method: String(property), args });
          return proxy;
        };
      }
    }
  );
  return proxy;
}

vi.mock("@/server/core/supabase", () => ({
  getSupabase: () => ({ admin: { from: () => builder() } }) as unknown as SupabaseService
}));

const { tasksRoutes } = await import("@/server/modules/tasks/routes");

function setup() {
  return createApiHandler(tasksRoutes, {
    basePath: "/api/v1",
    authenticate: async () => USER,
    resolveOrganization: async () => ORGANIZATION,
    rateLimiter: new MemoryRateLimiter()
  });
}

const call = (path: string) => new Request(`https://norte.sinipro.com/api/v1${path}`);
const TASK_ID = "3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b";

beforeEach(() => {
  results.length = 0;
  calls.length = 0;
});

describe("GET /tasks?ids=", () => {
  it("reads only the requested board tasks under the organization scope, with the list shape", async () => {
    results.push({
      data: [{ id: TASK_ID, title: "Renovar", messages: [{ count: 3 }], attachments: [{ count: 1 }] }]
    });
    const response = await setup()(call(`/tasks?ids=${TASK_ID}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      { id: TASK_ID, title: "Renovar", messages_count: 3, attachments_count: 1 }
    ]);
    expect(calls).toContainEqual({ method: "in", args: ["id", [TASK_ID]] });
    expect(calls).toContainEqual({ method: "eq", args: ["organization_id", "org-1"] });
    // Archived tasks never come back from the board read.
    expect(calls).toContainEqual({ method: "in", args: ["status", ["pendiente", "en_proceso", "revision"]] });
  });

  it("still serves the whole board without ids", async () => {
    results.push({ data: [] });
    const response = await setup()(call("/tasks"));
    expect(response.status).toBe(200);
    expect(calls.some((entry) => entry.method === "in" && entry.args[0] === "id")).toBe(false);
  });

  it("rejects a malformed or oversized ids filter", async () => {
    expect((await setup()(call("/tasks?ids=not-a-uuid"))).status).toBe(400);
    const tooMany = Array.from({ length: 21 }, () => TASK_ID).join(",");
    expect((await setup()(call(`/tasks?ids=${tooMany}`))).status).toBe(400);
  });
});
