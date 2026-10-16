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
vi.mock("@/server/core/supabase", () => ({
  getSupabase: () => ({ admin: { from: () => builder() } }) as unknown as SupabaseService
}));

const { policiesRoutes } = await import("@/server/modules/policies/routes");

function setup() {
  return createApiHandler(policiesRoutes, {
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
});

const DEFAULT = { limit: 300, ttlMs: 60_000 };
const UUID = "3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b";
const validPolicy = {
  clientId: UUID,
  insuranceCompanyId: UUID,
  branch: "Auto",
  policyNumber: "123",
  paymentIntervalMonths: 1,
  firstPaymentDate: "2026-01-01"
};

describe("policiesRoutes table", () => {
  it("matches the Nest PoliciesController (AuthGuard + OrganizationGuard at class level)", () => {
    expect(policiesRoutes.map((r) => [r.method, r.path, r.access, r.rateLimit])).toEqual([
      ["GET", "/policies", "organization", DEFAULT], // @Get()
      ["GET", "/policies/search", "organization", DEFAULT], // @Get("search")
      ["GET", "/policies/:id/notices", "organization", DEFAULT], // @Get(":id/notices")
      ["POST", "/policies", "organization", DEFAULT], // @Post()
      ["PATCH", "/policies/:id", "organization", DEFAULT], // @Patch(":id")
      ["DELETE", "/policies/:id", "organization", DEFAULT] // @Delete(":id")
    ]);
  });

  it("does not expose the removed policy analysis endpoint (S4)", () => {
    expect(policiesRoutes.some((r) => r.path.includes("analyze"))).toBe(false);
  });
});

describe("policies handlers", () => {
  it("sets X-Next-Cursor from created_at/id when the page is full", async () => {
    results.push({ data: [{ id: UUID, created_at: "2026-06-10T13:00:00.123456+00:00" }] });
    const response = await setup()(call("/policies?limit=1"));

    expect(response.status).toBe(200);
    const cursor = response.headers.get("X-Next-Cursor") as string;
    expect(JSON.parse(Buffer.from(cursor, "base64url").toString())).toEqual({
      created_at: "2026-06-10T13:00:00.123456+00:00",
      id: UUID
    });
  });

  it("answers { items, total, page, pageSize } in paginated mode", async () => {
    results.push({ count: 1 }, { data: [{ id: "a" }] });
    const response = await setup()(call("/policies?pageSize=10&branch=Auto"));
    expect(await response.json()).toEqual({ items: [{ id: "a" }], total: 1, page: 1, pageSize: 10 });
    expect(calls).toContainEqual({ method: "eq", args: ["branch", "Auto"] });
  });

  it("rejects pageSize above the hard cap and a non-uuid companyId", async () => {
    expect((await setup()(call("/policies?pageSize=51"))).status).toBe(400);
    expect((await setup()(call("/policies?companyId=x"))).status).toBe(400);
  });

  it("POST validates the body and answers 201", async () => {
    expect((await setup()(json("POST", "/policies", { branch: "Auto" }))).status).toBe(400);

    results.push({ data: { id: "p1" } });
    const created = await setup()(json("POST", "/policies", validPolicy));
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ id: "p1" });
    expect(calls).toContainEqual({
      method: "insert",
      args: [
        expect.objectContaining({
          organization_id: "org-1",
          created_by_user_id: "user-1",
          payment_method: "manual",
          vehicle_plate: null
        })
      ]
    });
  });

  it("PATCH maps PGRST116 to 404 and P0001 to the trigger message", async () => {
    results.push({ error: { code: "PGRST116", message: "none" } });
    const missing = await setup()(json("PATCH", `/policies/${UUID}`, { branch: "Hogar" }));
    expect(missing.status).toBe(404);
    expect((await missing.json()).message).toBe("Policy not found");

    results.push({ error: { code: "P0001", message: "Fecha inválida" } });
    const trigger = await setup()(json("PATCH", `/policies/${UUID}`, { branch: "Hogar" }));
    expect(trigger.status).toBe(400);
    expect((await trigger.json()).message).toBe("Fecha inválida");
  });

  it("PATCH rejects a new due date that collides with an existing notice", async () => {
    results.push(
      { data: { first_payment_date: "2026-01-01", payment_method: "manual" } },
      {
        data: [
          { due_date: "2026-01-01", status: "avisar", deleted_at: null },
          { due_date: "2026-02-01", status: "pagado", deleted_at: null }
        ]
      }
    );
    const response = await setup()(json("PATCH", `/policies/${UUID}`, { firstPaymentDate: "2026-02-01" }));
    expect(response.status).toBe(400);
    expect((await response.json()).message).toBe(
      "Esta póliza ya tiene un aviso con esa fecha de vencimiento. Elegí otra fecha."
    );
  });

  it("GET :id/notices 404s for a policy outside the organization", async () => {
    results.push({ data: null });
    const response = await setup()(call(`/policies/${UUID}/notices`));
    expect(response.status).toBe(404);
    expect((await response.json()).message).toBe("Policy not found");
  });

  it("DELETE soft-deletes the policy and its notices", async () => {
    results.push({ data: { id: UUID } }, {}, {});
    const response = await setup()(call(`/policies/${UUID}`, { method: "DELETE" }));
    expect(await response.json()).toEqual({ ok: true });
  });
});
