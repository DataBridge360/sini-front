import { describe, expect, it } from "vitest";
import { clubPlazaRegistrationsRoutes } from "@/server/modules/club-plaza-registrations/routes";

// Tabla de seguridad: [method, path, access, rateLimit] tal cual la declara el
// controller de Nest (backend/src/club-plaza-registrations/club-plaza-registrations.controller.ts). Si una ruta cambia de
// nivel de acceso, este test tiene que cambiar a propósito.
const DEFAULT_RATE_LIMIT = { limit: 300, ttlMs: 60_000 };

const EXPECTED = [
  ["GET", "/club-plaza-registrations", "organization"],
  ["GET", "/club-plaza-registrations/payers", "organization"],
  ["POST", "/club-plaza-registrations", "organization"],
  ["POST", "/club-plaza-registrations/bulk", "organization"],
  ["POST", "/club-plaza-registrations/corrections", "organization"],
  ["PATCH", "/club-plaza-registrations/:id", "organization"],
  ["DELETE", "/club-plaza-registrations/:id", "organization"]
] as const;

describe("clubPlazaRegistrationsRoutes", () => {
  it("matches the Nest controller table (method, path, access, rate limit), in order", () => {
    const actual = clubPlazaRegistrationsRoutes.map((entry) => [entry.method, entry.path, entry.access, entry.rateLimit]);
    expect(actual).toEqual(EXPECTED.map(([method, path, access]) => [method, path, access, DEFAULT_RATE_LIMIT]));
  });

  it("requires an organization context on every route", () => {
    expect(clubPlazaRegistrationsRoutes.every((entry) => entry.access === "organization")).toBe(true);
  });
});
