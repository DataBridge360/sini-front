import { describe, expect, it } from "vitest";
import { chartInputSchema, chartSpecSchema } from "@/lib/gesti-parts";

const card = (overrides: Record<string, unknown> = {}) => ({
  title: "Llamar a Ana",
  subtitle: "Renovación",
  badge: "Pendiente",
  fields: [
    { label: "Vence", value: "20/10" },
    { label: "Prima", value: 1500 }
  ],
  ...overrides
});
const cards = (count: number) => Array.from({ length: count }, (_, index) => card({ title: `Tarea ${index + 1}` }));
const stat = (overrides: Record<string, unknown> = {}) => ({ label: "Pólizas", value: 42, hint: "activas", ...overrides });
const stats = (count: number) => Array.from({ length: count }, (_, index) => stat({ label: `Dato ${index + 1}` }));

describe("cards kind", () => {
  const input = (overrides: Record<string, unknown> = {}) => ({ kind: "cards", title: "Tareas", cards: cards(2), ...overrides });

  it("accepts 1 to 12 cards with optional subtitle, badge, fields and ref", () => {
    for (const count of [1, 2, 12]) expect(chartInputSchema.safeParse(input({ cards: cards(count) })).success, `${count}`).toBe(true);
    const minimal = chartInputSchema.parse(input({ cards: [{ title: "Solo título" }] }));
    expect(minimal.cards).toEqual([{ title: "Solo título" }]);
    const withRef = chartInputSchema.parse(input({ cards: [card({ ref: "#Rk7q2-3" }), card({ ref: null })] }));
    expect(withRef.cards?.map((item) => item.ref)).toEqual(["#Rk7q2-3", null]);
  });

  it("rejects no cards, too many cards and a missing cards array", () => {
    expect(chartInputSchema.safeParse(input({ cards: [] })).success).toBe(false);
    expect(chartInputSchema.safeParse(input({ cards: cards(13) })).success).toBe(false);
    expect(chartInputSchema.safeParse({ kind: "cards", title: "Tareas" }).success).toBe(false);
  });

  it("bounds lengths and field counts", () => {
    expect(chartInputSchema.safeParse(input({ cards: [card({ title: "" })] })).success).toBe(false);
    expect(chartInputSchema.safeParse(input({ cards: [card({ title: "x".repeat(121) })] })).success).toBe(false);
    expect(chartInputSchema.safeParse(input({ cards: [card({ subtitle: "x".repeat(201) })] })).success).toBe(false);
    expect(chartInputSchema.safeParse(input({ cards: [card({ badge: "x".repeat(31) })] })).success).toBe(false);
    expect(chartInputSchema.safeParse(input({ cards: [card({ ref: "x".repeat(41) })] })).success).toBe(false);
    const fields = (count: number) => Array.from({ length: count }, (_, index) => ({ label: `Campo ${index}`, value: "x" }));
    expect(chartInputSchema.safeParse(input({ cards: [card({ fields: fields(8) })] })).success).toBe(true);
    expect(chartInputSchema.safeParse(input({ cards: [card({ fields: fields(9) })] })).success).toBe(false);
    expect(chartInputSchema.safeParse(input({ cards: [card({ fields: [{ label: "x".repeat(41), value: "y" }] })] })).success).toBe(false);
    expect(chartInputSchema.safeParse(input({ cards: [card({ fields: [{ label: "a", value: "y".repeat(201) }] })] })).success).toBe(false);
    expect(chartInputSchema.safeParse(input({ cards: [card({ fields: [{ label: "a", value: Number.POSITIVE_INFINITY }] })] })).success).toBe(false);
  });

  it("does not let the model inject a link into a card (the input strips it)", () => {
    const parsed = chartInputSchema.parse(input({ cards: [card({ link: { kind: "task", id: "x" } })], links: [{ kind: "task", id: "x" }] }));
    expect(JSON.stringify(parsed)).not.toContain('"link');
    expect(parsed).not.toHaveProperty("links");
  });

  it("stores resolved links beside the cards and never the opaque ref", () => {
    const stored = chartSpecSchema.parse({
      kind: "cards",
      title: "Tareas",
      cards: [card({ ref: "#Rk7q2-3" }), card()],
      links: [{ kind: "task", id: "t1" }, null],
      position: 10
    });
    expect(stored.links).toEqual([{ kind: "task", id: "t1" }, null]);
    expect(stored.cards?.[0]).not.toHaveProperty("ref");
    expect(chartSpecSchema.safeParse({ kind: "cards", title: "T", cards: cards(13) }).success).toBe(false);
    expect(chartSpecSchema.safeParse({ kind: "cards", title: "T" }).success).toBe(false);
    expect(chartSpecSchema.safeParse({ kind: "cards", title: "T", cards: cards(1), links: [{ kind: "database", id: "x" }] }).success).toBe(false);
  });
});

describe("stats kind", () => {
  const input = (overrides: Record<string, unknown> = {}) => ({ kind: "stats", title: "Resumen", items: stats(3), ...overrides });

  it("accepts 2 to 6 items with a string or number value and an optional hint", () => {
    for (const count of [2, 3, 6]) expect(chartInputSchema.safeParse(input({ items: stats(count) })).success, `${count}`).toBe(true);
    expect(chartInputSchema.safeParse(input({ items: [stat({ value: "$1.200" }), { label: "Sin hint", value: 0 }] })).success).toBe(true);
    expect(chartSpecSchema.safeParse(input()).success).toBe(true);
  });

  it("rejects fewer than 2, more than 6 and a missing list", () => {
    for (const schema of [chartInputSchema, chartSpecSchema]) {
      expect(schema.safeParse(input({ items: stats(1) })).success).toBe(false);
      expect(schema.safeParse(input({ items: stats(7) })).success).toBe(false);
      expect(schema.safeParse({ kind: "stats", title: "Resumen" }).success).toBe(false);
    }
  });

  it("bounds lengths and rejects non finite numbers and empty labels", () => {
    expect(chartInputSchema.safeParse(input({ items: [stat(), stat({ label: "" })] })).success).toBe(false);
    expect(chartInputSchema.safeParse(input({ items: [stat(), stat({ label: "x".repeat(61) })] })).success).toBe(false);
    expect(chartInputSchema.safeParse(input({ items: [stat(), stat({ value: "x".repeat(41) })] })).success).toBe(false);
    expect(chartInputSchema.safeParse(input({ items: [stat(), stat({ value: "" })] })).success).toBe(false);
    expect(chartInputSchema.safeParse(input({ items: [stat(), stat({ value: Number.NaN })] })).success).toBe(false);
    expect(chartInputSchema.safeParse(input({ items: [stat(), stat({ hint: "x".repeat(101) })] })).success).toBe(false);
  });
});

describe("existing kinds", () => {
  it("still validate and still parse old stored messages", () => {
    const table = { kind: "table", title: "T", columns: ["a"], rows: [["x"]] };
    const pie = { kind: "pie", title: "P", labels: ["A"], series: [{ name: "n", values: [1] }] };
    for (const spec of [table, pie]) {
      expect(chartInputSchema.safeParse(spec).success).toBe(true);
      expect(chartSpecSchema.safeParse(spec).success).toBe(true);
    }
    expect(chartSpecSchema.safeParse({ kind: "table", title: "T" }).success).toBe(false);
  });
});
