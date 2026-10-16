import { describe, expect, it, vi } from "vitest";
import type { AuthUser, OrganizationContext } from "@/server/core/context";
import { ForbiddenException, UnauthorizedException } from "@/server/core/http-errors";
import { MemoryRateLimiter } from "@/server/core/rate-limit";
import { createApiHandler, type Route } from "@/server/core/router";

const signInWithPassword = vi.fn();
vi.mock("@/server/core/supabase", () => ({
  getSupabase: () => ({ publicAuth: { auth: { signInWithPassword } }, admin: {} })
}));

import { authRoutes } from "@/server/modules/auth/routes";

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

/** [method, path, access, rateLimit, bodyLimitBytes] por ruta, en orden de declaración. */
function table(routes: Route[]) {
  return routes.map((r) => [r.method, r.path, r.access, r.rateLimit, r.bodyLimitBytes]);
}

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

describe("authRoutes", () => {
  // auth.controller.ts: @Controller("auth"), sin guards.
  it("matches the Nest AuthController table", () => {
    expect(table(authRoutes)).toEqual([
      // @Throttle 10/min + @Post("login")
      ["POST", "/auth/login", "public", { limit: 10, ttlMs: 60_000 }, DEFAULT_BODY],
      // @Throttle 30/min + @Post("refresh")
      ["POST", "/auth/refresh", "public", { limit: 30, ttlMs: 60_000 }, DEFAULT_BODY]
    ]);
  });

  it("validates the login body like ZodValidationPipe", async () => {
    const { handle, authenticate } = setup(authRoutes);
    const response = await handle(jsonCall("POST", "/auth/login", { email: "nope", password: "" }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.message).toBe("Validation failed");
    expect(body.issues).toHaveLength(2);
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("answers invalid credentials with 401", async () => {
    signInWithPassword.mockResolvedValueOnce({ data: {}, error: { message: "bad" } });
    const { handle } = setup(authRoutes);
    const response = await handle(jsonCall("POST", "/auth/login", { email: "ana@example.com", password: "x" }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      message: "Invalid credentials",
      error: "Unauthorized",
      statusCode: 401
    });
  });

  it("throttles login after 10 attempts per IP", async () => {
    signInWithPassword.mockResolvedValue({ data: {}, error: { message: "bad" } });
    const { handle } = setup(authRoutes);
    const attempt = () =>
      handle(jsonCall("POST", "/auth/login", { email: "ana@example.com", password: "x" }, { "x-real-ip": "9.9.9.9" }));

    for (let index = 0; index < 10; index += 1) {
      expect((await attempt()).status).toBe(401);
    }
    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ statusCode: 429, message: "ThrottlerException: Too Many Requests" });

    const otherIp = await handle(
      jsonCall("POST", "/auth/login", { email: "ana@example.com", password: "x" }, { "x-real-ip": "8.8.8.8" })
    );
    expect(otherIp.status).toBe(401);
  });

  it("does not expose GET on the auth paths", async () => {
    const { handle } = setup(authRoutes);
    expect((await handle(call("/auth/login"))).status).toBe(404);
  });
});
