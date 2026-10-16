import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { AuthUser, OrganizationContext } from "@/server/core/context";
import { ConflictException, ForbiddenException, UnauthorizedException } from "@/server/core/http-errors";
import { MemoryRateLimiter } from "@/server/core/rate-limit";
import { createApiHandler, route, type ApiDependencies, type Route } from "@/server/core/router";

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

const UUID = "3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b";

function setup(routes: Route[], overrides: Partial<ApiDependencies> = {}) {
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
    return ORGANIZATION;
  });
  const deps: ApiDependencies = {
    basePath: "/api/v1",
    authenticate,
    resolveOrganization,
    rateLimiter: new MemoryRateLimiter(),
    ...overrides
  };
  return { handle: createApiHandler(routes, deps), authenticate, resolveOrganization };
}

function call(path: string, init: RequestInit & { headers?: Record<string, string> } = {}) {
  return new Request(`https://norte.sinipro.com/api/v1${path}`, init);
}

const authed = { authorization: "Bearer good", "x-organization-slug": "norte" };

describe("createApiHandler", () => {
  it("answers unknown paths with the Nest 404 body", async () => {
    const { handle } = setup([]);
    const response = await handle(call("/nope"));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      message: "Cannot GET /nope",
      error: "Not Found",
      statusCode: 404
    });
  });

  it("treats a known path with another method as not found", async () => {
    const handler = vi.fn(() => ({ ok: true }));
    const { handle } = setup([route({ method: "GET", path: "/clients", access: "organization", handler })]);
    const response = await handle(call("/clients", { method: "DELETE", headers: authed }));

    expect(response.status).toBe(404);
    expect(handler).not.toHaveBeenCalled();
  });

  it("runs public routes without authenticating", async () => {
    const { handle, authenticate } = setup([
      route({ method: "GET", path: "/organizations/slug/:slug", access: "public", handler: ({ params }) => ({ slug: params.slug }) })
    ]);
    const response = await handle(call("/organizations/slug/norte"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ slug: "norte" });
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("rejects user routes without a valid token before the handler runs", async () => {
    const handler = vi.fn(() => ({ ok: true }));
    const { handle } = setup([route({ method: "GET", path: "/profile", access: "user", handler })]);
    const response = await handle(call("/profile"));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      message: "Missing bearer token",
      error: "Unauthorized",
      statusCode: 401
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("gives user routes the user and never resolves an organization", async () => {
    const { handle, resolveOrganization } = setup([
      route({ method: "GET", path: "/profile", access: "user", handler: ({ user }) => ({ id: user.id }) })
    ]);
    const response = await handle(call("/profile", { headers: { authorization: "Bearer good" } }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: "user-1" });
    expect(resolveOrganization).not.toHaveBeenCalled();
  });

  it("rejects organization routes without membership before the handler runs", async () => {
    const handler = vi.fn(() => ({ ok: true }));
    const { handle } = setup([route({ method: "GET", path: "/clients", access: "organization", handler })]);
    const response = await handle(call("/clients", { headers: { authorization: "Bearer good", "x-organization-slug": "sur" } }));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      message: "User has no access to this organization",
      error: "Forbidden",
      statusCode: 403
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("checks the token before the organization", async () => {
    const { handle, resolveOrganization } = setup([
      route({ method: "GET", path: "/clients", access: "organization", handler: () => [] })
    ]);
    const response = await handle(call("/clients", { headers: { "x-organization-slug": "norte" } }));

    expect(response.status).toBe(401);
    expect(resolveOrganization).not.toHaveBeenCalled();
  });

  it("passes user, organization, decoded params and response headers to organization routes", async () => {
    const { handle } = setup([
      route({
        method: "GET",
        path: "/clients/:id",
        access: "organization",
        handler: ({ user, organization, params, setHeader }) => {
          setHeader("X-Next-Cursor", "abc");
          return { user: user.id, organization: organization.id, id: params.id };
        }
      })
    ]);
    const response = await handle(call("/clients/a%20b", { headers: authed }));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-next-cursor")).toBe("abc");
    expect(await response.json()).toEqual({ user: "user-1", organization: "org-1", id: "a b" });
  });

  it("matches routes in declaration order like Express", async () => {
    const { handle } = setup([
      route({ method: "GET", path: "/tasks/stats", access: "organization", handler: () => ({ route: "stats" }) }),
      route({ method: "GET", path: "/tasks/:id", access: "organization", handler: () => ({ route: "id" }) })
    ]);

    expect(await (await handle(call("/tasks/stats", { headers: authed }))).json()).toEqual({ route: "stats" });
    expect(await (await handle(call(`/tasks/${UUID}`, { headers: authed }))).json()).toEqual({ route: "id" });
  });

  it("answers POST with 201 and other methods with 200, like Nest", async () => {
    const { handle } = setup([
      route({ method: "POST", path: "/clients", access: "organization", handler: () => ({ created: true }) }),
      route({ method: "PATCH", path: "/clients/:id", access: "organization", handler: () => ({ updated: true }) })
    ]);

    expect((await handle(call("/clients", { method: "POST", headers: authed }))).status).toBe(201);
    expect((await handle(call("/clients/1", { method: "PATCH", headers: authed }))).status).toBe(200);
  });

  it("answers an empty 200 when the handler returns nothing", async () => {
    const { handle } = setup([route({ method: "DELETE", path: "/x", access: "public", handler: () => undefined })]);
    const response = await handle(call("/x", { method: "DELETE" }));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
  });

  it("validates JSON bodies with the Nest ZodValidationPipe body", async () => {
    const handler = vi.fn();
    const { handle } = setup([
      route({
        method: "POST",
        path: "/clients",
        access: "organization",
        handler: async ({ body }) => handler(await body(z.object({ name: z.string().min(1) })))
      })
    ]);
    const response = await handle(
      call("/clients", { method: "POST", headers: { ...authed, "content-type": "application/json" }, body: JSON.stringify({ name: "" }) })
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.message).toBe("Validation failed");
    expect(payload.issues[0].path).toEqual(["name"]);
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns the parsed body when it is valid", async () => {
    const { handle } = setup([
      route({
        method: "POST",
        path: "/clients",
        access: "organization",
        handler: async ({ body }) => body(z.object({ name: z.string().trim() }))
      })
    ]);
    const response = await handle(
      call("/clients", { method: "POST", headers: { ...authed, "content-type": "application/json" }, body: JSON.stringify({ name: " Ana " }) })
    );

    expect(await response.json()).toEqual({ name: "Ana" });
  });

  it("rejects malformed JSON with 400", async () => {
    const { handle } = setup([
      route({ method: "POST", path: "/clients", access: "organization", handler: async ({ body }) => body(z.unknown()) })
    ]);
    const response = await handle(
      call("/clients", { method: "POST", headers: { ...authed, "content-type": "application/json" }, body: "{nope" })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ message: "Invalid JSON body", error: "Bad Request", statusCode: 400 });
  });

  it("rejects JSON bodies over 256 KB by default with 413", async () => {
    const handler = vi.fn();
    const { handle } = setup([
      route({ method: "POST", path: "/clients", access: "organization", handler: async ({ body }) => handler(await body(z.unknown())) })
    ]);
    const big = JSON.stringify({ text: "a".repeat(256 * 1024) });
    const response = await handle(
      call("/clients", { method: "POST", headers: { ...authed, "content-type": "application/json" }, body: big })
    );

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      message: "request entity too large",
      error: "Payload Too Large",
      statusCode: 413
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("honors a per-route body limit", async () => {
    const { handle } = setup([
      route({
        method: "PATCH",
        path: "/profile",
        access: "user",
        bodyLimitBytes: 1024 * 1024,
        handler: async ({ body }) => {
          await body(z.unknown());
          return { ok: true };
        }
      })
    ]);
    const response = await handle(
      call("/profile", {
        method: "PATCH",
        headers: { authorization: "Bearer good", "content-type": "application/json" },
        body: JSON.stringify({ avatar: "a".repeat(600 * 1024) })
      })
    );

    expect(response.status).toBe(200);
  });

  it("reads multipart bodies and rejects them over the route limit", async () => {
    const { handle } = setup([
      route({
        method: "POST",
        path: "/organizations/current/logo",
        access: "organization",
        handler: async ({ formData }) => {
          const form = await formData(1024);
          const file = form.get("file") as File;
          return { kind: form.get("kind"), size: file.size };
        }
      })
    ]);
    const send = (bytes: number) => {
      const form = new FormData();
      form.set("kind", "login");
      form.set("file", new File(["a".repeat(bytes)], "logo.png", { type: "image/png" }));
      return handle(call("/organizations/current/logo", { method: "POST", headers: authed, body: form }));
    };

    const ok = await send(10);
    expect(ok.status).toBe(201);
    expect(await ok.json()).toEqual({ kind: "login", size: 10 });

    const big = await send(4096);
    expect(big.status).toBe(413);
  });

  it("parses query strings, keeping repeated keys as arrays", async () => {
    const { handle } = setup([
      route({
        method: "GET",
        path: "/tasks",
        access: "organization",
        handler: ({ query }) =>
          query(z.object({ page: z.coerce.number(), status: z.array(z.string()) }))
      })
    ]);
    const response = await handle(call("/tasks?page=2&status=todo&status=done", { headers: authed }));

    expect(await response.json()).toEqual({ page: 2, status: ["todo", "done"] });
  });

  it("rejects an invalid query with the validation body", async () => {
    const { handle } = setup([
      route({ method: "GET", path: "/tasks", access: "organization", handler: ({ query }) => query(z.object({ page: z.coerce.number().int() })) })
    ]);
    const response = await handle(call("/tasks?page=x", { headers: authed }));

    expect(response.status).toBe(400);
    expect((await response.json()).message).toBe("Validation failed");
  });

  it("rejects non-UUID ids like ParseUUIDPipe", async () => {
    const handler = vi.fn();
    const { handle } = setup([
      route({ method: "GET", path: "/tasks/:id", access: "organization", handler: ({ uuidParam }) => handler(uuidParam("id")) })
    ]);
    const response = await handle(call("/tasks/123", { headers: authed }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      message: "Validation failed (uuid is expected)",
      error: "Bad Request",
      statusCode: 400
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns object error bodies untouched so the frontend keeps reading code", async () => {
    const { handle } = setup([
      route({
        method: "POST",
        path: "/clients",
        access: "organization",
        handler: () => {
          throw new ConflictException({ statusCode: 409, code: "CLIENT_DUPLICATE_DNI", message: "Ya hay un asegurado" });
        }
      })
    ]);
    const response = await handle(call("/clients", { method: "POST", headers: authed }));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ statusCode: 409, code: "CLIENT_DUPLICATE_DNI", message: "Ya hay un asegurado" });
  });

  it("hides unexpected errors behind a generic 500", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { handle } = setup([
      route({ method: "GET", path: "/boom", access: "public", handler: () => { throw new Error("db password is hunter2"); } })
    ]);
    const response = await handle(call("/boom"));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ statusCode: 500, message: "Internal server error" });
    errorSpy.mockRestore();
  });

  it("rate limits per route and IP before authenticating", async () => {
    const { handle, authenticate } = setup([
      route({
        method: "POST",
        path: "/auth/login",
        access: "public",
        rateLimit: { limit: 2, ttlMs: 60_000 },
        handler: () => ({ ok: true })
      }),
      route({ method: "GET", path: "/profile", access: "user", rateLimit: { limit: 1, ttlMs: 60_000 }, handler: () => ({}) })
    ]);
    const login = () => handle(call("/auth/login", { method: "POST", headers: { "x-forwarded-for": "1.1.1.1" } }));

    expect((await login()).status).toBe(201);
    expect((await login()).status).toBe(201);
    const limited = await login();
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ statusCode: 429, message: "ThrottlerException: Too Many Requests" });

    const otherIp = await handle(call("/auth/login", { method: "POST", headers: { "x-forwarded-for": "2.2.2.2" } }));
    expect(otherIp.status).toBe(201);

    await handle(call("/profile", { headers: { authorization: "Bearer good", "x-forwarded-for": "1.1.1.1" } }));
    authenticate.mockClear();
    const profileLimited = await handle(call("/profile", { headers: { authorization: "Bearer good", "x-forwarded-for": "1.1.1.1" } }));
    expect(profileLimited.status).toBe(429);
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("applies the global 300 requests per minute limit by default", async () => {
    const { handle } = setup([route({ method: "GET", path: "/ping", access: "public", handler: () => ({}) })]);
    let last = 0;
    for (let i = 0; i < 301; i += 1) {
      last = (await handle(call("/ping", { headers: { "x-forwarded-for": "9.9.9.9" } }))).status;
    }

    expect(last).toBe(429);
  });
});
