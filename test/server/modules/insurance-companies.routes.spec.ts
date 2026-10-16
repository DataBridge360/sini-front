import { describe, expect, it, vi } from "vitest";
import type { AuthUser, OrganizationContext } from "@/server/core/context";
import { ForbiddenException, UnauthorizedException } from "@/server/core/http-errors";
import { MemoryRateLimiter } from "@/server/core/rate-limit";
import { createApiHandler, type Route } from "@/server/core/router";

const from = vi.fn();
vi.mock("@/server/core/supabase", () => ({
  getSupabase: () => ({ admin: { from }, publicAuth: {} })
}));

import { insuranceCompaniesRoutes } from "@/server/modules/insurance-companies/routes";

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

const authed = { authorization: "Bearer good", "x-organization-slug": "norte" };

/** [method, path, access, rateLimit, bodyLimitBytes] por ruta, en orden de declaración. */
function table(routes: Route[]) {
  return routes.map((r) => [r.method, r.path, r.access, r.rateLimit, r.bodyLimitBytes]);
}

const DEFAULT_RATE = { limit: 300, ttlMs: 60_000 };
const DEFAULT_BODY = 256 * 1024;

function setup(routes: Route[], organization: OrganizationContext = ORGANIZATION) {
  const authenticate = vi.fn(async (headers: Headers) => {
    if (headers.get("authorization") !== "Bearer good") {
      throw new UnauthorizedException("Missing bearer token");
    }
    return USER;
  });
  const resolveOrganization = vi.fn(async (headers: Headers) => {
    if (headers.get("x-organization-slug") !== "norte") {
      throw new ForbiddenException("User has no access to this organization");
    }
    return organization;
  });
  const handle = createApiHandler(routes, {
    basePath: "/api/v1",
    authenticate,
    resolveOrganization,
    rateLimiter: new MemoryRateLimiter()
  });
  return { handle, authenticate, resolveOrganization };
}

function call(path: string, init: RequestInit = {}) {
  return new Request(`https://norte.sinipro.com/api/v1${path}`, init);
}

function jsonCall(method: string, path: string, body: unknown, headers: Record<string, string> = {}) {
  return call(path, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
}

/**
 * Query builder falso de supabase-js: cualquier método encadena y los
 * terminales (maybeSingle/single/await) resuelven `result`.
 */
function fakeQuery(result: unknown) {
  const chain: Record<string, unknown> = {};
  const proxy: unknown = new Proxy(chain, {
    get(_target, prop) {
      if (prop === "then") {
        return (resolve: (value: unknown) => unknown) => resolve(result);
      }
      if (prop === "maybeSingle" || prop === "single") {
        return () => Promise.resolve(result);
      }
      return () => proxy;
    }
  });
  return proxy;
}

describe("insuranceCompaniesRoutes", () => {
  // insurance-companies.controller.ts: @UseGuards(AuthGuard, OrganizationGuard) a nivel clase.
  it("matches the Nest InsuranceCompaniesController table", () => {
    expect(table(insuranceCompaniesRoutes)).toEqual([
      ["GET", "/insurance-companies", "organization", DEFAULT_RATE, DEFAULT_BODY],
      ["POST", "/insurance-companies", "organization", DEFAULT_RATE, DEFAULT_BODY]
    ]);
  });

  it("requires authentication and organization", async () => {
    const { handle } = setup(insuranceCompaniesRoutes);

    expect((await handle(call("/insurance-companies"))).status).toBe(401);
    const noOrg = await handle(call("/insurance-companies", { headers: { authorization: "Bearer good" } }));
    expect(noOrg.status).toBe(403);
  });

  it("lists the companies of the organization", async () => {
    from.mockReturnValueOnce(fakeQuery({ data: [{ id: "1", name: "Sancor" }], error: null }));
    const { handle } = setup(insuranceCompaniesRoutes);
    const response = await handle(call("/insurance-companies", { headers: authed }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ id: "1", name: "Sancor" }]);
    expect(from).toHaveBeenCalledWith("insurance_companies");
  });

  it("creates with 201 and trims the name", async () => {
    const created = { id: "2", name: "Zurich", is_active: true, created_at: "2026-01-01" };
    from.mockReturnValueOnce(fakeQuery({ data: created, error: null }));
    const { handle } = setup(insuranceCompaniesRoutes);
    const response = await handle(jsonCall("POST", "/insurance-companies", { name: "  Zurich " }, authed));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(created);
  });

  it("rejects a too short name", async () => {
    const { handle } = setup(insuranceCompaniesRoutes);
    const response = await handle(jsonCall("POST", "/insurance-companies", { name: "a" }, authed));

    expect(response.status).toBe(400);
  });

  it("answers a database failure with the Spanish fallback message", async () => {
    from.mockReturnValueOnce(fakeQuery({ data: null, error: { message: "boom" } }));
    const { handle } = setup(insuranceCompaniesRoutes);
    const response = await handle(call("/insurance-companies", { headers: authed }));

    expect(response.status).toBe(400);
    expect((await response.json()).message).toBe("No se pudieron obtener las compañías.");
  });
});
