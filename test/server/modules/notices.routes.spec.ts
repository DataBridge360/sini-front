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
  role: "productor"
};

// Query builder falso: cada método encadena y el await final devuelve el próximo resultado encolado.
const results: Array<{ data?: unknown; error?: unknown; count?: number }> = [];
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
const rpcResults: Array<{ data?: unknown; error?: unknown }> = [];
const rpcCalls: Array<{ name: string; args: unknown }> = [];

vi.mock("@/server/core/supabase", () => ({
  getSupabase: () =>
    ({
      admin: {
        from: () => builder(),
        rpc: async (name: string, args: unknown) => {
          rpcCalls.push({ name, args });
          return { error: null, ...(rpcResults.shift() ?? { data: null }) };
        }
      }
    }) as unknown as SupabaseService
}));

const { noticesRoutes } = await import("@/server/modules/notices/routes");

function setup() {
  return createApiHandler(noticesRoutes, {
    basePath: "/api/v1",
    authenticate: async () => USER,
    resolveOrganization: async () => ORGANIZATION,
    rateLimiter: new MemoryRateLimiter()
  });
}

function call(path: string, init: RequestInit = {}) {
  return new Request(`https://norte.sinipro.com/api/v1${path}`, init);
}

function json(method: string, path: string, body: unknown) {
  return call(path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

beforeEach(() => {
  results.length = 0;
  calls.length = 0;
  rpcResults.length = 0;
  rpcCalls.length = 0;
});

const DEFAULT = { limit: 300, ttlMs: 60_000 };
const NOTICE_ID = "3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b";

describe("noticesRoutes table", () => {
  it("matches the Nest NoticesController (AuthGuard + OrganizationGuard at class level)", () => {
    expect(noticesRoutes.map((r) => [r.method, r.path, r.access, r.rateLimit])).toEqual([
      ["GET", "/notices", "organization", DEFAULT], // @Get()
      ["PATCH", "/notices/:id/notified", "organization", DEFAULT], // @Patch(":id/notified")
      ["PATCH", "/notices/:id/pay", "organization", DEFAULT], // @Patch(":id/pay")
      ["PATCH", "/notices/:id/revert", "organization", DEFAULT], // @Patch(":id/revert")
      ["POST", "/notices/:id/notes", "organization", DEFAULT], // @Post(":id/notes")
      ["DELETE", "/notices/:id/notes/:noteId", "organization", DEFAULT] // @Delete(":id/notes/:noteId")
    ]);
  });
});

describe("notices handlers", () => {
  it("sets X-Next-Cursor from the last due_date/id when the page is full", async () => {
    results.push({ data: [{ id: NOTICE_ID, due_date: "2026-01-02" }] });
    const response = await setup()(call("/notices?limit=1&status=avisar"));

    expect(response.status).toBe(200);
    const cursor = response.headers.get("X-Next-Cursor") as string;
    expect(JSON.parse(Buffer.from(cursor, "base64url").toString())).toEqual({
      due_date: "2026-01-02",
      id: NOTICE_ID
    });
    expect(calls).toContainEqual({ method: "eq", args: ["status", "avisar"] });
  });

  it("rejects an unknown status", async () => {
    const response = await setup()(call("/notices?status=nope"));
    expect(response.status).toBe(400);
  });

  it("404 Notice not found when the notice is outside the organization", async () => {
    results.push({ data: null });
    const response = await setup()(call(`/notices/${NOTICE_ID}/notified`, { method: "PATCH" }));
    expect(response.status).toBe(404);
    expect((await response.json()).message).toBe("Notice not found");
  });

  it("pay calls the RPC scoped to the organization and returns the first row", async () => {
    results.push({ data: { id: NOTICE_ID } });
    rpcResults.push({ data: [{ id: "paid" }, { id: "next" }] });
    const response = await setup()(json("PATCH", `/notices/${NOTICE_ID}/pay`, { paymentIntervalMonths: "3" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: "paid" });
    expect(rpcCalls).toEqual([
      {
        name: "process_policy_notice_payment",
        args: {
          p_notice_id: NOTICE_ID,
          p_interval_months: 3,
          p_processed_by_user_id: "user-1",
          p_organization_id: "org-1"
        }
      }
    ]);
  });

  it("POST notes answers 201 and validates the note", async () => {
    results.push({ data: { id: NOTICE_ID } }, { data: { id: "note-1" } });
    const created = await setup()(json("POST", `/notices/${NOTICE_ID}/notes`, { note: "  hola  " }));
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ id: "note-1" });

    const invalid = await setup()(json("POST", `/notices/${NOTICE_ID}/notes`, { note: "   " }));
    expect(invalid.status).toBe(400);
  });

  it("DELETE note: 404 Note not found, then { ok: true }", async () => {
    results.push({ data: { id: NOTICE_ID } }, { data: null });
    const missing = await setup()(call(`/notices/${NOTICE_ID}/notes/n1`, { method: "DELETE" }));
    expect(missing.status).toBe(404);
    expect((await missing.json()).message).toBe("Note not found");

    results.push({ data: { id: NOTICE_ID } }, { data: { id: "n1" } });
    const ok = await setup()(call(`/notices/${NOTICE_ID}/notes/n1`, { method: "DELETE" }));
    expect(await ok.json()).toEqual({ ok: true });
  });
});
