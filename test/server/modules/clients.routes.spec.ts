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

const { clientsRoutes } = await import("@/server/modules/clients/routes");

function setup() {
  return createApiHandler(clientsRoutes, {
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

const CLIENT_ID = "3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b";

beforeEach(() => {
  results.length = 0;
  calls.length = 0;
});

describe("clientsRoutes table", () => {
  it("matches the Nest ClientsController (AuthGuard + OrganizationGuard at class level)", () => {
    expect(
      clientsRoutes.map((r) => [r.method, r.path, r.access, r.rateLimit])
    ).toEqual([
      ["GET", "/clients", "organization", { limit: 300, ttlMs: 60_000 }], // @Get()
      ["GET", "/clients/search", "organization", { limit: 300, ttlMs: 60_000 }], // @Get("search")
      ["GET", "/clients/localities", "organization", { limit: 300, ttlMs: 60_000 }], // @Get("localities")
      ["POST", "/clients", "organization", { limit: 300, ttlMs: 60_000 }], // @Post()
      ["PATCH", "/clients/:id", "organization", { limit: 300, ttlMs: 60_000 }], // @Patch(":id")
      ["DELETE", "/clients/:id", "organization", { limit: 300, ttlMs: 60_000 }] // @Delete(":id")
    ]);
  });
});

describe("clients handlers", () => {
  it("returns a plain array and sets X-Next-Cursor when a full page comes back", async () => {
    const id = "3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b";
    results.push({ data: [{ id, full_name: "Ana" }] });
    const response = await setup()(call("/clients?limit=1"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ id, full_name: "Ana" }]);
    const cursor = response.headers.get("X-Next-Cursor") as string;
    expect(JSON.parse(Buffer.from(cursor, "base64url").toString())).toEqual({ full_name: "Ana", id });
  });

  it("omits X-Next-Cursor without a limit", async () => {
    results.push({ data: [{ id: "a", full_name: "Ana" }] });
    const response = await setup()(call("/clients"));
    expect(response.headers.get("X-Next-Cursor")).toBeNull();
  });

  it("answers { items, total, page, pageSize } in paginated mode, clamping the page", async () => {
    results.push({ count: 3 }, { data: [{ id: "a" }] });
    const response = await setup()(call("/clients?page=9&pageSize=2"));
    expect(await response.json()).toEqual({ items: [{ id: "a" }], total: 3, page: 2, pageSize: 2 });
  });

  it("rejects an invalid query with the validation body", async () => {
    const response = await setup()(call("/clients/search?limit=99"));
    expect(response.status).toBe(400);
    expect((await response.json()).message).toBe("Validation failed");
  });

  it("409 CLIENT_DUPLICATE_NAME when the name exists and no DNI is given", async () => {
    results.push({ data: [{ id: "x", full_name: "Juan Perez" }] });
    const response = await setup()(json("POST", "/clients", { fullName: "juan perez" }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      statusCode: 409,
      code: "CLIENT_DUPLICATE_NAME",
      message: "Ya hay un asegurado llamado Juan Perez. Cargá el DNI para diferenciarlos."
    });
  });

  it("409 CLIENT_DUPLICATE_DNI on unique violation, and 201 on success", async () => {
    results.push({ error: { code: "23505", message: "dup" } });
    const conflict = await setup()(json("POST", "/clients", { fullName: "Juan", dni: "123" }));
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({
      statusCode: 409,
      code: "CLIENT_DUPLICATE_DNI",
      message: "Ya hay un asegurado cargado con ese DNI. Revisá si no es la misma persona."
    });

    results.push({ data: { id: "new" } });
    const created = await setup()(json("POST", "/clients", { fullName: "Juan", dni: "123", email: "" }));
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ id: "new" });
  });

  it("404 when updating a client that does not exist", async () => {
    results.push({ data: null });
    const response = await setup()(json("PATCH", `/clients/${CLIENT_ID}`, { phone: "1" }));
    expect(response.status).toBe(404);
    expect((await response.json()).message).toBe("Client not found");
  });

  it("DELETE soft-deletes and answers { ok: true }", async () => {
    results.push({ data: { id: "abc" } }, { data: [] }, { data: null });
    const response = await setup()(call(`/clients/${CLIENT_ID}`, { method: "DELETE" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  // S4: el id se valida como UUID antes de leer el body o tocar la base.
  it.each([
    ["PATCH", "/clients/not-a-uuid"],
    ["DELETE", "/clients/not-a-uuid"]
  ])("%s %s answers 400 uuid-expected without reading the body or querying", async (method, path) => {
    const response = await setup()(
      call(path, { method, headers: { "content-type": "application/json" }, body: method === "PATCH" ? "{not json" : null })
    );
    expect(response.status).toBe(400);
    expect((await response.json()).message).toBe("Validation failed (uuid is expected)");
    expect(calls).toEqual([]);
  });
});
