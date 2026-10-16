import { describe, expect, it } from "vitest";
import { apiRoutes } from "@/server/routes";

// Auditoría de la tabla completa: lo único público es lo que era público en Nest.
describe("apiRoutes", () => {
  it("only exposes login, refresh and organization branding without authentication", () => {
    const publicRoutes = apiRoutes
      .filter((route) => route.access === "public")
      .map((route) => `${route.method} ${route.path}`);

    expect(publicRoutes).toEqual([
      "POST /auth/login",
      "POST /auth/refresh",
      "GET /organizations/slug/:slug"
    ]);
  });

  it("keeps profile routes at user level and everything else at organization level", () => {
    const userRoutes = apiRoutes
      .filter((route) => route.access === "user")
      .map((route) => `${route.method} ${route.path}`);

    expect(userRoutes).toEqual(["GET /profile", "PATCH /profile", "PATCH /profile/password"]);
  });

  it("does not serve the removed AI policy analysis", () => {
    expect(apiRoutes.some((route) => route.path === "/policies/analyze")).toBe(false);
  });

  it("has no duplicated method and path", () => {
    const keys = apiRoutes.map((route) => `${route.method} ${route.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
