import { describe, expect, it } from "vitest";
import { canTransitionStatus, transitionErrorMessage } from "@/server/modules/tasks/tasks.rules";
import { taskStatusValues, type TaskStatus } from "@/server/modules/tasks/schemas";

// La matriz completa, explícita. Es la regla de negocio crítica del módulo: si
// se afloja, un asesor puede aprobar su propio trabajo.
//
//   fila = desde, columna = hacia, valor = quién puede
type Who = "nadie" | "todos" | "productor";

const MATRIX: Record<TaskStatus, Record<TaskStatus, Who>> = {
  pendiente: {
    pendiente: "nadie",
    en_proceso: "todos",
    revision: "todos",
    finalizado: "productor"
  },
  en_proceso: {
    pendiente: "todos",
    en_proceso: "nadie",
    revision: "todos",
    finalizado: "productor"
  },
  revision: {
    pendiente: "productor",
    en_proceso: "productor",
    revision: "nadie",
    finalizado: "productor"
  },
  finalizado: {
    pendiente: "productor",
    en_proceso: "productor",
    revision: "productor",
    finalizado: "nadie"
  }
};

describe("canTransitionStatus", () => {
  for (const from of taskStatusValues) {
    for (const to of taskStatusValues) {
      const who = MATRIX[from][to];

      it(`${from} -> ${to}: asesor ${who === "todos" ? "puede" : "no puede"}`, () => {
        expect(canTransitionStatus(from, to, false)).toBe(who === "todos");
      });

      it(`${from} -> ${to}: productor ${who === "nadie" ? "no puede" : "puede"}`, () => {
        expect(canTransitionStatus(from, to, true)).toBe(who !== "nadie");
      });
    }
  }

  it("un asesor no puede sacar una tarea de revisión ni devolviéndola atrás", () => {
    expect(canTransitionStatus("revision", "pendiente", false)).toBe(false);
    expect(canTransitionStatus("revision", "en_proceso", false)).toBe(false);
  });

  it("un asesor no puede desarchivar", () => {
    expect(canTransitionStatus("finalizado", "en_proceso", false)).toBe(false);
  });
});

describe("transitionErrorMessage", () => {
  it("explica el caso concreto en vez de un genérico", () => {
    expect(transitionErrorMessage("revision", "finalizado")).toContain("aprobar");
    expect(transitionErrorMessage("finalizado", "en_proceso")).toContain("desarchivar");
    expect(transitionErrorMessage("revision", "pendiente")).toContain("revisión");
  });
});
