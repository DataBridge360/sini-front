import { describe, expect, it, vi } from "vitest";
import type { AuthUser, OrganizationContext } from "@/server/core/context";
import { ForbiddenException, UnauthorizedException } from "@/server/core/http-errors";
import { MemoryRateLimiter } from "@/server/core/rate-limit";
import { createApiHandler, type Route } from "@/server/core/router";

const from = vi.fn();
vi.mock("@/server/core/supabase", () => ({
  getSupabase: () => ({ admin: { from }, publicAuth: {} })
}));

import { profileRoutes } from "@/server/modules/profile/routes";

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

describe("profileRoutes", () => {
  // profile.controller.ts: @UseGuards(AuthGuard) a nivel clase; main.ts: json 1mb en /profile.
  it("matches the Nest ProfileController table", () => {
    expect(table(profileRoutes)).toEqual([
      ["GET", "/profile", "user", DEFAULT_RATE, DEFAULT_BODY],
      ["PATCH", "/profile", "user", DEFAULT_RATE, 1024 * 1024],
      ["PATCH", "/profile/password", "user", DEFAULT_RATE, 1024 * 1024]
    ]);
  });

  it("requires a bearer token and does not need an organization", async () => {
    const { handle, resolveOrganization } = setup(profileRoutes);

    expect((await handle(call("/profile"))).status).toBe(401);
    from.mockReturnValueOnce(
      fakeQuery({
        data: { id: "user-1", email: "ana@example.com", full_name: "Ana", avatar_url: null, platform_role: "user", is_active: true },
        error: null
      })
    );
    const response = await handle(call("/profile", { headers: { authorization: "Bearer good" } }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: "user-1",
      email: "ana@example.com",
      fullName: "Ana",
      avatarUrl: null,
      platformRole: "user"
    });
    expect(resolveOrganization).not.toHaveBeenCalled();
  });

  it("accepts a PATCH /profile body above 256 KB and up to 1 MB", async () => {
    from.mockReturnValueOnce(
      fakeQuery({
        data: { id: "user-1", email: "ana@example.com", full_name: "Ana Perez", avatar_url: null, platform_role: "user" },
        error: null
      })
    );
    const { handle } = setup(profileRoutes);
    const filler = "x".repeat(300 * 1024);
    const response = await handle(jsonCall("PATCH", "/profile", { fullName: "Ana Perez", filler }, authed));

    expect(response.status).toBe(200);
  });

  it("rejects a PATCH /profile body above 1 MB with 413", async () => {
    const { handle } = setup(profileRoutes);
    const filler = "x".repeat(1024 * 1024 + 1);
    const response = await handle(jsonCall("PATCH", "/profile", { fullName: "Ana Perez", filler }, authed));

    expect(response.status).toBe(413);
  });

  it("applies the 1 MB /profile limit to PATCH /profile/password too, like Nest", async () => {
    const { handle } = setup(profileRoutes);
    const filler = "x".repeat(1024 * 1024 + 1);
    const response = await handle(
      jsonCall("PATCH", "/profile/password", { currentPassword: "a", newPassword: "12345678", confirmPassword: "12345678", filler }, authed)
    );

    expect(response.status).toBe(413);
  });

  it("validates avatar format and password confirmation", async () => {
    const { handle } = setup(profileRoutes);

    const avatar = await handle(
      jsonCall("PATCH", "/profile", { fullName: "Ana Perez", avatarUrl: "http://evil/x.png" }, authed)
    );
    expect(avatar.status).toBe(400);

    const password = await handle(
      jsonCall("PATCH", "/profile/password", { currentPassword: "a", newPassword: "12345678", confirmPassword: "87654321" }, authed)
    );
    expect(password.status).toBe(400);
    expect((await password.json()).issues[0].message).toBe("Passwords do not match");
  });
});
