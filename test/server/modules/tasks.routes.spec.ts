import { describe, expect, it } from "vitest";
import { tasksRoutes } from "@/server/modules/tasks/routes";

// Tabla de seguridad: [method, path, access, rateLimit] tal cual la declara el
// controller de Nest (backend/src/tasks/tasks.controller.ts). Si una ruta cambia de
// nivel de acceso, este test tiene que cambiar a propósito.
const DEFAULT_RATE_LIMIT = { limit: 300, ttlMs: 60_000 };

const EXPECTED = [
  ["GET", "/tasks", "organization"],
  ["GET", "/tasks/stats", "organization"],
  ["GET", "/tasks/:id", "organization"],
  ["POST", "/tasks", "organization"],
  ["PATCH", "/tasks/:id", "organization"],
  ["PATCH", "/tasks/:id/status", "organization"],
  ["DELETE", "/tasks/:id", "organization"],
  ["DELETE", "/tasks/:id/messages/:messageId", "organization"],
  ["DELETE", "/tasks/:id/attachments/:attachmentId", "organization"]
] as const;

describe("tasksRoutes", () => {
  it("matches the Nest controller table (method, path, access, rate limit), in order", () => {
    const actual = tasksRoutes.map((entry) => [entry.method, entry.path, entry.access, entry.rateLimit]);
    expect(actual).toEqual(EXPECTED.map(([method, path, access]) => [method, path, access, DEFAULT_RATE_LIMIT]));
  });

  it("requires an organization context on every route", () => {
    expect(tasksRoutes.every((entry) => entry.access === "organization")).toBe(true);
  });

  it("keeps static segments before the :id routes of the same method", () => {
    const paths = tasksRoutes.map((entry) => `${entry.method} ${entry.path}`);
    expect(paths.indexOf("GET /tasks/stats")).toBeLessThan(paths.indexOf("GET /tasks/:id"));
  });
});
