import { describe, expect, it, vi } from "vitest";
import type { AuthUser, OrganizationContext } from "@/server/core/context";
import { ForbiddenException, UnauthorizedException } from "@/server/core/http-errors";
import { MemoryRateLimiter } from "@/server/core/rate-limit";
import { createApiHandler, type Route } from "@/server/core/router";

const from = vi.fn();
const upload = vi.fn();
const getPublicUrl = vi.fn();
vi.mock("@/server/core/supabase", () => ({
  getSupabase: () => ({
    admin: { from, storage: { from: () => ({ upload, getPublicUrl }) } },
    publicAuth: {}
  })
}));

import { organizationsRoutes } from "@/server/modules/organizations/routes";

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

describe("organizationsRoutes", () => {
  // organizations.controller.ts: sin guard de clase; AuthGuard + OrganizationGuard por método.
  it("matches the Nest OrganizationsController table", () => {
    expect(table(organizationsRoutes)).toEqual([
      // @Get("slug/:slug") sin guards
      ["GET", "/organizations/slug/:slug", "public", DEFAULT_RATE, DEFAULT_BODY],
      ["GET", "/organizations/current", "organization", DEFAULT_RATE, DEFAULT_BODY],
      ["PATCH", "/organizations/current", "organization", DEFAULT_RATE, DEFAULT_BODY],
      ["GET", "/organizations/current/team", "organization", DEFAULT_RATE, DEFAULT_BODY],
      ["GET", "/organizations/current/members", "organization", DEFAULT_RATE, DEFAULT_BODY],
      ["POST", "/organizations/current/team", "organization", DEFAULT_RATE, DEFAULT_BODY],
      ["PATCH", "/organizations/current/team/:membershipId", "organization", DEFAULT_RATE, DEFAULT_BODY],
      ["PATCH", "/organizations/current/team/:membershipId/password", "organization", DEFAULT_RATE, DEFAULT_BODY],
      ["PATCH", "/organizations/current/team/:membershipId/deactivate", "organization", DEFAULT_RATE, DEFAULT_BODY],
      ["POST", "/organizations/current/logo", "organization", DEFAULT_RATE, DEFAULT_BODY]
    ]);
  });

  it("serves the public branding by slug without authenticating and hides contact data", async () => {
    from.mockReturnValueOnce(
      fakeQuery({
        data: { slug: "norte", display_name: "Norte", support_email: "a@b.com", support_phone: "123", status: "active" },
        error: null
      })
    );
    const { handle, authenticate } = setup(organizationsRoutes);
    const response = await handle(call("/organizations/slug/norte"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      slug: "norte",
      display_name: "Norte",
      support_email: null,
      support_phone: null,
      status: "active"
    });
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("answers an unknown slug with 404", async () => {
    from.mockReturnValueOnce(fakeQuery({ data: null, error: null }));
    const { handle } = setup(organizationsRoutes);
    const response = await handle(call("/organizations/slug/nope"));

    expect(response.status).toBe(404);
    expect((await response.json()).message).toBe("Organization not found");
  });

  it("requires authentication and organization on the current-organization routes", async () => {
    const { handle } = setup(organizationsRoutes);

    expect((await handle(call("/organizations/current"))).status).toBe(401);
    const noOrg = await handle(call("/organizations/current/members", { headers: { authorization: "Bearer good" } }));
    expect(noOrg.status).toBe(403);
  });

  it("limits team management to producers", async () => {
    const { handle } = setup(organizationsRoutes, { ...ORGANIZATION, role: "asesor" });
    const response = await handle(call("/organizations/current/team", { headers: authed }));

    expect(response.status).toBe(403);
    expect((await response.json()).message).toBe("Only producers can manage organization team");
  });

  it("validates the team member body", async () => {
    const { handle } = setup(organizationsRoutes);
    const response = await handle(
      jsonCall("POST", "/organizations/current/team", { fullName: "A", email: "x", role: "admin", password: "1" }, authed)
    );

    expect(response.status).toBe(400);
    expect((await response.json()).message).toBe("Validation failed");
  });

  // S4: el membershipId se valida como UUID antes de leer el body o tocar la base.
  it.each([
    "/organizations/current/team/not-a-uuid",
    "/organizations/current/team/not-a-uuid/password",
    "/organizations/current/team/not-a-uuid/deactivate"
  ])("PATCH %s answers 400 uuid-expected without reading the body or querying", async (path) => {
    from.mockClear();
    const { handle } = setup(organizationsRoutes);
    const response = await handle(
      call(path, { method: "PATCH", headers: { ...authed, "content-type": "application/json" }, body: "{not json" })
    );

    expect(response.status).toBe(400);
    expect((await response.json()).message).toBe("Validation failed (uuid is expected)");
    expect(from).not.toHaveBeenCalled();
  });

  describe("POST /organizations/current/logo", () => {
    const png = () => new File([new Uint8Array([1, 2, 3, 4])], "Mi Logo!.png", { type: "image/png" });

    function logoRequest(form: FormData) {
      return call("/organizations/current/logo", { method: "POST", headers: authed, body: form });
    }

    it("uploads the logo, derives a safe path and updates the organization", async () => {
      upload.mockResolvedValueOnce({ error: null });
      getPublicUrl.mockReturnValueOnce({ data: { publicUrl: "https://cdn/logo.png" } });
      from.mockReturnValueOnce(fakeQuery({ data: { id: "org-1", login_logo_url: "https://cdn/logo.png" }, error: null }));
      const { handle } = setup(organizationsRoutes);
      const form = new FormData();
      form.append("kind", "login");
      form.append("file", png());
      const response = await handle(logoRequest(form));

      expect(response.status).toBe(201);
      expect(await response.json()).toEqual({
        url: "https://cdn/logo.png",
        organization: { id: "org-1", login_logo_url: "https://cdn/logo.png" }
      });
      const [path, buffer, options] = upload.mock.calls.at(-1) as [string, Buffer, Record<string, unknown>];
      expect(path).toMatch(/^org-1\/login-\d+-mi-logo\.png$/);
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.length).toBe(4);
      expect(options).toEqual({ cacheControl: "31536000", contentType: "image/png", upsert: false });
    });

    it("rejects a file above 2,000,000 bytes with 413 File too large", async () => {
      const { handle } = setup(organizationsRoutes);
      const form = new FormData();
      form.append("file", new File([new Uint8Array(2_000_001)], "big.png", { type: "image/png" }));
      const response = await handle(logoRequest(form));

      expect(response.status).toBe(413);
      expect(await response.json()).toEqual({
        message: "File too large",
        error: "Payload Too Large",
        statusCode: 413
      });
    });

    it("accepts a file of exactly 2,000,000 bytes", async () => {
      upload.mockResolvedValueOnce({ error: null });
      getPublicUrl.mockReturnValueOnce({ data: { publicUrl: "https://cdn/big.png" } });
      from.mockReturnValueOnce(fakeQuery({ data: { id: "org-1" }, error: null }));
      const { handle } = setup(organizationsRoutes);
      const form = new FormData();
      form.append("file", new File([new Uint8Array(2_000_000)], "big.png", { type: "image/png" }));
      const response = await handle(logoRequest(form));

      expect(response.status).toBe(201);
    });

    it("rejects a missing file with 400 Logo image is required", async () => {
      const { handle } = setup(organizationsRoutes);
      const response = await handle(logoRequest(new FormData()));

      expect(response.status).toBe(400);
      expect((await response.json()).message).toBe("Logo image is required");
    });

    it("treats a non-multipart request as having no file, like multer", async () => {
      const { handle } = setup(organizationsRoutes);
      const response = await handle(jsonCall("POST", "/organizations/current/logo", {}, authed));

      expect(response.status).toBe(400);
      expect((await response.json()).message).toBe("Logo image is required");
    });

    it("rejects a file in another field with 400 Unexpected field", async () => {
      const { handle } = setup(organizationsRoutes);
      const form = new FormData();
      form.append("logo", png());
      const response = await handle(logoRequest(form));

      expect(response.status).toBe(400);
      expect((await response.json()).message).toBe("Unexpected field");
    });

    it("rejects non-image mime types", async () => {
      const { handle } = setup(organizationsRoutes);
      const form = new FormData();
      form.append("file", new File([new Uint8Array([1])], "x.svg", { type: "image/svg+xml" }));
      const response = await handle(logoRequest(form));

      expect(response.status).toBe(400);
      expect((await response.json()).message).toBe("Logo must be a PNG, JPG, WEBP or GIF image");
    });

    it("forbids non-producers before touching storage", async () => {
      upload.mockClear();
      const { handle } = setup(organizationsRoutes, { ...ORGANIZATION, role: "asesor" });
      const form = new FormData();
      form.append("file", png());
      const response = await handle(logoRequest(form));

      expect(response.status).toBe(403);
      expect(upload).not.toHaveBeenCalled();
    });
  });
});
