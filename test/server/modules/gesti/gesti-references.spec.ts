import { describe, expect, it } from "vitest";
import { chartInputSchema, chartSpecSchema, type ChartLink } from "@/lib/gesti-parts";
import { RecordRegistry, resolveRowLinks } from "@/server/modules/gesti/references";

const TASK: ChartLink = { kind: "task", id: "66666666-6666-4666-8666-666666666666" };
const CLIENT: ChartLink = { kind: "client", id: "22222222-2222-4222-8222-222222222222" };
const POLICY: ChartLink = { kind: "policy", id: "33333333-3333-4333-8333-333333333333", clientId: CLIENT.id };

describe("RecordRegistry", () => {
  it("hands out opaque sequential references and resolves them back", () => {
    const registry = new RecordRegistry(undefined, "ab12");

    expect(registry.register(TASK)).toBe("#Rab12-1");
    expect(registry.register(CLIENT)).toBe("#Rab12-2");
    expect(registry.register(POLICY)).toBe("#Rab12-3");

    expect(registry.resolve("#Rab12-1")).toEqual(TASK);
    expect(registry.resolve("#Rab12-3")).toEqual(POLICY);
    // La referencia no contiene nada del registro.
    expect(["#Rab12-1", "#Rab12-2", "#Rab12-3"].join("")).not.toMatch(/[0-9a-f]{8}-/);
  });

  it("gives the same record the same reference across tool calls", () => {
    const registry = new RecordRegistry(undefined, "ab12");
    const first = registry.register(POLICY);
    registry.register(TASK);

    expect(registry.register({ ...POLICY })).toBe(first);
    expect(registry.size).toBe(2);
  });

  it("drops unknown and malformed references silently", () => {
    const registry = new RecordRegistry(undefined, "ab12");
    registry.register(TASK);

    for (const bad of ["#Rab12-2", "#Rab12-0", "#Rab12-01", "R1", "#r1", "#R", "#R1; drop table", "#R1", "#RAB12-1", "#Rab12-1-1", "#R-1", "", " ", TASK.id, 1, null, undefined, {}, ["#Rab12-1"]]) {
      expect(registry.resolve(bad), `${String(bad)}`).toBeNull();
    }
    expect(registry.resolve("  #Rab12-1 ")).toEqual(TASK);
  });

  it("never resolves a reference issued in another turn, even with the same number", () => {
    const otherTurn = new RecordRegistry(undefined, "ab12");
    const thisTurn = new RecordRegistry(undefined, "cd34");
    const old = otherTurn.register(TASK);
    thisTurn.register(CLIENT);

    expect(old).toBe("#Rab12-1");
    expect(thisTurn.resolve(old)).toBeNull();
    expect(thisTurn.resolve("#Rcd34-1")).toEqual(CLIENT);
  });

  it("tags each turn's references differently by default", () => {
    const tags = new Set(Array.from({ length: 20 }, () => new RecordRegistry().register(TASK)?.slice(0, 6)));
    expect(tags.size).toBeGreaterThan(1);
    for (const tag of tags) expect(tag).toMatch(/^#R[a-z0-9]{4}$/);
  });

  it("returns copies, so a resolved link cannot change the registry", () => {
    const registry = new RecordRegistry(undefined, "ab12");
    registry.register(POLICY);
    const link = registry.resolve("#Rab12-1")!;
    link.id = "tampered";

    expect(registry.resolve("#Rab12-1")).toEqual(POLICY);
  });

  it("stops issuing references past the per-turn cap", () => {
    const registry = new RecordRegistry(3, "ab12");
    registry.register(TASK);
    registry.register(CLIENT);
    registry.register(POLICY);

    expect(registry.register({ kind: "task", id: "another" })).toBeNull();
    expect(registry.register(TASK)).toBe("#Rab12-1");
  });
});

describe("resolveRowLinks", () => {
  it("resolves one link per row and leaves unknown ones null", () => {
    const registry = new RecordRegistry(undefined, "ab12");
    registry.register(TASK);
    registry.register(CLIENT);

    expect(resolveRowLinks(registry, ["#Rab12-2", null, "#Rab12-99", "junk", "#Rab12-1"], 5)).toEqual([CLIENT, null, null, null, TASK]);
  });

  it("returns nothing when no row resolves, and ignores references past the last row", () => {
    const registry = new RecordRegistry(undefined, "ab12");
    registry.register(TASK);

    expect(resolveRowLinks(registry, ["#Rab12-7", "nope"], 2)).toBeUndefined();
    expect(resolveRowLinks(registry, undefined, 2)).toBeUndefined();
    expect(resolveRowLinks(registry, ["#Rab12-1", "#Rab12-1", "#Rab12-1"], 1)).toEqual([TASK]);
  });
});

describe("show_chart schemas", () => {
  const table = { kind: "table", title: "Tareas", columns: ["Tarea"], rows: [["Llamar a Ana"], ["Renovar"]] };

  it("accepts per-row references from the model but never raw links or positions", () => {
    const parsed = chartInputSchema.parse({
      ...table,
      refs: ["#Rab12-1", null],
      links: [{ kind: "task", id: TASK.id }],
      position: 3
    });

    expect(parsed).toMatchObject({ refs: ["#Rab12-1", null] });
    expect(parsed).not.toHaveProperty("links");
    expect(parsed).not.toHaveProperty("position");
  });

  it("does not offer links or positions in the JSON schema the model sees", async () => {
    const { toolInputSchema } = await import("@/server/modules/gesti/schemas");
    const schema = toolInputSchema(chartInputSchema) as { properties?: Record<string, unknown> };
    const properties = Object.keys(schema.properties ?? {});

    expect(properties).toContain("refs");
    expect(properties).not.toContain("links");
    expect(properties).not.toContain("position");
  });

  it("stores resolved links and the text position next to the chart", () => {
    const stored = chartSpecSchema.parse({ ...table, links: [TASK, null], position: 42 });

    expect(stored.links).toEqual([TASK, null]);
    expect(stored.position).toBe(42);
    expect(chartSpecSchema.safeParse(table).success).toBe(true);
    expect(chartSpecSchema.safeParse({ ...table, position: -1 }).success).toBe(false);
    expect(chartSpecSchema.safeParse({ ...table, links: [{ kind: "database", id: "x" }] }).success).toBe(false);
  });
});
