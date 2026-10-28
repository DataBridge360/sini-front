import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GestiChart } from "@/components/ui/gesti-chart";
import {
  donutSlicePath,
  formatNumber,
  formatPercent,
  formatValue,
  groupSlices,
  isNumericColumn,
  niceTicks,
  planXLabels,
  recordDestination,
  recordLinkLabel,
  shouldCompact,
  shouldIncludeZero,
  sortRows,
  summarizeChart,
  tableEntries,
  truncateLabel
} from "@/lib/gesti-chart-format";
import type { ChartLink, ChartSpec } from "@/lib/gesti-parts";

describe("niceTicks", () => {
  it("rounds a positive range to a readable step that includes zero", () => {
    const scale = niceTicks(0, 97);
    expect(scale.ticks).toEqual([0, 25, 50, 75, 100]);
    expect(scale.min).toBe(0);
    expect(scale.max).toBe(100);
  });

  it("keeps between 3 and 5 ticks for ordinary ranges", () => {
    for (const max of [3, 7, 42, 130, 999, 15_000, 2_345_678, 0.8]) {
      const { ticks } = niceTicks(0, max);
      expect(ticks.length).toBeGreaterThanOrEqual(3);
      expect(ticks.length).toBeLessThanOrEqual(5);
      expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(max);
    }
  });

  it("covers negative values and crosses zero", () => {
    const scale = niceTicks(-30, 80);
    expect(scale.min).toBeLessThanOrEqual(-30);
    expect(scale.max).toBeGreaterThanOrEqual(80);
    expect(scale.ticks).toContain(0);
    expect(scale.ticks).toEqual([...scale.ticks].sort((a, b) => a - b));
  });

  it("handles all-negative data by extending up to zero", () => {
    const scale = niceTicks(-120, -20);
    expect(scale.max).toBe(0);
    expect(scale.min).toBeLessThanOrEqual(-120);
  });

  it("returns a usable scale for a zero range", () => {
    expect(niceTicks(0, 0).ticks).toEqual([0, 0.25, 0.5, 0.75, 1]);
    const flat = niceTicks(7, 7, { includeZero: false });
    expect(flat.min).toBeLessThan(7);
    expect(flat.max).toBeGreaterThan(7);
  });

  it("avoids floating point noise in fractional steps", () => {
    const { ticks } = niceTicks(0, 0.3);
    expect(ticks).toEqual([0, 0.1, 0.2, 0.3]);
  });

  it("never returns NaN for odd input", () => {
    const odd: [number, number][] = [[Number.NaN, Number.NaN], [Infinity, -Infinity], [5, -5]];
    for (const [min, max] of odd) {
      const scale = niceTicks(min, max);
      expect(scale.ticks.every(Number.isFinite)).toBe(true);
      expect(scale.max).toBeGreaterThan(scale.min);
    }
  });

  it("can zoom in when zero is not requested", () => {
    const scale = niceTicks(90, 100, { includeZero: false });
    expect(scale.min).toBeGreaterThan(0);
  });
});

describe("shouldIncludeZero", () => {
  it("keeps zero for bars and areas, and for lines with real spread", () => {
    expect(shouldIncludeZero("bar", 90, 100)).toBe(true);
    expect(shouldIncludeZero("area", 90, 100)).toBe(true);
    expect(shouldIncludeZero("line", 10, 100)).toBe(true);
    expect(shouldIncludeZero("line", -5, 20)).toBe(true);
  });

  it("zooms in lines whose positive values are almost equal", () => {
    expect(shouldIncludeZero("line", 90, 100)).toBe(false);
    expect(shouldIncludeZero("line", 50, 50)).toBe(false);
  });
});

describe("formatNumber", () => {
  it("uses es-AR separators and always groups thousands", () => {
    expect(formatNumber(1234)).toBe("1.234");
    expect(formatNumber(1234567.891)).toBe("1.234.567,89");
    expect(formatNumber(0.5)).toBe("0,5");
  });

  it("keeps the sign and never prints negative zero", () => {
    expect(formatNumber(-1234.5)).toBe("-1.234,5");
    expect(formatNumber(-0)).toBe("0");
    expect(formatNumber(-0.001)).toBe("0");
  });

  it("returns a dash for non finite values", () => {
    expect(formatNumber(Number.NaN)).toBe("—");
    expect(formatNumber(Infinity)).toBe("—");
  });

  it("abbreviates thousands, millions and billions in compact mode", () => {
    expect(formatNumber(950, { compact: true })).toBe("950");
    expect(formatNumber(12_345, { compact: true })).toBe("12,3 mil");
    expect(formatNumber(1_500_000, { compact: true })).toBe("1,5 M");
    expect(formatNumber(2_500_000_000, { compact: true })).toBe("2,5 mil M");
    expect(formatNumber(3_000_000_000_000, { compact: true })).toBe("3 B");
    expect(formatNumber(-2_000_000, { compact: true })).toBe("-2 M");
  });

  it("moves to the next unit when rounding reaches 1000", () => {
    expect(formatNumber(999_960, { compact: true })).toBe("1 M");
  });
});

describe("shouldCompact", () => {
  it("starts abbreviating at 10 thousand", () => {
    expect(shouldCompact(9_999)).toBe(false);
    expect(shouldCompact(10_000)).toBe(true);
    expect(shouldCompact(Number.NaN)).toBe(false);
  });
});

describe("formatValue", () => {
  it("puts $ before the number", () => {
    expect(formatValue(1500, "$")).toBe("$1.500");
    expect(formatValue(-1500.5, "$")).toBe("-$1.500,5");
    expect(formatValue(2_500_000, "$", { compact: true })).toBe("$2,5 M");
  });

  it("glues % after the number", () => {
    expect(formatValue(12.5, "%")).toBe("12,5%");
    expect(formatValue(-3, "%")).toBe("-3%");
  });

  it("separates other units with a space", () => {
    expect(formatValue(42, "pólizas")).toBe("42 pólizas");
    expect(formatValue(1200, "días")).toBe("1.200 días");
  });

  it("prints the bare number without unit", () => {
    expect(formatValue(1234)).toBe("1.234");
    expect(formatValue(5, "  ")).toBe("5");
  });

  it("returns a dash for non finite values", () => {
    expect(formatValue(Number.NaN, "$")).toBe("—");
  });
});

describe("formatPercent", () => {
  it("formats a share with at most one decimal", () => {
    expect(formatPercent(0.125)).toBe("12,5%");
    expect(formatPercent(1)).toBe("100%");
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(1 / 3)).toBe("33,3%");
  });
});

describe("truncateLabel", () => {
  it("shortens long labels with an ellipsis and keeps short ones", () => {
    expect(truncateLabel("Enero", 10)).toBe("Enero");
    expect(truncateLabel("Responsabilidad civil", 10)).toBe("Responsab…");
    expect(truncateLabel("Responsabilidad civil", 10)).toHaveLength(10);
  });
});

describe("planXLabels", () => {
  it("keeps every label horizontal when there is room", () => {
    expect(planXLabels(6, 600, 5)).toEqual({ step: 1, rotate: false });
  });

  it("skips some labels before rotating when one skip is enough", () => {
    expect(planXLabels(12, 400, 5)).toEqual({ step: 2, rotate: false });
  });

  it("rotates and thins when labels are crowded", () => {
    expect(planXLabels(30, 300, 10)).toEqual({ step: 2, rotate: true });
    expect(planXLabels(12, 300, 12)).toEqual({ step: 1, rotate: true });
  });

  it("handles a single label or an empty plot", () => {
    expect(planXLabels(1, 300, 30)).toEqual({ step: 1, rotate: false });
    expect(planXLabels(5, 0, 10)).toEqual({ step: 1, rotate: false });
  });
});

describe("sortRows", () => {
  const rows = [
    ["Bravo", 20],
    ["alfa", 5],
    ["Charlie", null],
    ["Delta", 100]
  ];

  it("sorts numbers numerically and puts empty cells last in both directions", () => {
    expect(sortRows(rows, 1, "asc").map((row) => row[0])).toEqual(["alfa", "Bravo", "Delta", "Charlie"]);
    expect(sortRows(rows, 1, "desc").map((row) => row[0])).toEqual(["Delta", "Bravo", "alfa", "Charlie"]);
  });

  it("sorts text with the es-AR collation ignoring case", () => {
    expect(sortRows(rows, 0, "asc").map((row) => row[0])).toEqual(["alfa", "Bravo", "Charlie", "Delta"]);
  });

  it("sorts dd/mm and dd/mm/yyyy dates by date, not as text", () => {
    const dates = [
      ["a", "01/11"],
      ["b", "30/10"],
      ["c", "28/10 (hoy)"],
      ["d", "5/1/2027"],
      ["e", "31/12/2026"]
    ];
    expect(sortRows(dates.slice(0, 3), 1, "asc").map((row) => row[0])).toEqual(["c", "b", "a"]);
    expect(sortRows(dates.slice(0, 3), 1, "desc").map((row) => row[0])).toEqual(["a", "b", "c"]);
    expect(sortRows(dates.slice(3), 1, "asc").map((row) => row[0])).toEqual(["e", "d"]);
  });

  it("keeps comparing as text when only one side is a date", () => {
    const mixed = [
      ["a", "Sin fecha"],
      ["b", "01/11"]
    ];
    expect(sortRows(mixed, 1, "asc").map((row) => row[0])).toEqual(["b", "a"]);
  });

  it("does not mutate the input", () => {
    const copy = rows.map((row) => [...row]);
    sortRows(rows, 1, "desc");
    expect(rows).toEqual(copy);
  });
});

describe("isNumericColumn", () => {
  it("is numeric only when every filled cell is a number", () => {
    expect(isNumericColumn([[1], [null], [3]], 0)).toBe(true);
    expect(isNumericColumn([[1], ["x"]], 0)).toBe(false);
    expect(isNumericColumn([[null]], 0)).toBe(false);
    expect(isNumericColumn([], 0)).toBe(false);
  });
});

describe("groupSlices", () => {
  it("keeps the slices as they come when they fit", () => {
    const slices = groupSlices(["A", "B"], [3, 1]);
    expect(slices.map((slice) => slice.label)).toEqual(["A", "B"]);
  });

  it("groups the smallest into Otros when there are too many", () => {
    const labels = ["A", "B", "C", "D", "E", "F", "G", "H"];
    const slices = groupSlices(labels, [50, 1, 40, 2, 30, 3, 20, 4], 6);
    expect(slices).toHaveLength(6);
    expect(slices.map((slice) => slice.label)).toEqual(["A", "C", "E", "G", "H", "Otros"]);
    const others = slices.at(-1);
    expect(others?.label).toBe("Otros");
    expect(others?.value).toBe(1 + 2 + 3);
    expect(others?.sourceIndexes).toEqual([1, 3, 5]);
  });

  it("clamps negative and invalid values to zero", () => {
    const slices = groupSlices(["A", "B"], [-5, Number.NaN]);
    expect(slices.map((slice) => slice.value)).toEqual([0, 0]);
  });
});

describe("donutSlicePath", () => {
  it("draws a closed ring slice", () => {
    const path = donutSlicePath(80, 80, 70, 45, 0, Math.PI / 2);
    expect(path.startsWith("M80 10")).toBe(true);
    expect(path.endsWith("Z")).toBe(true);
  });

  it("splits a full circle in two halves and ignores empty slices", () => {
    const full = donutSlicePath(80, 80, 70, 45, 0, Math.PI * 2);
    expect(full.match(/M/g)).toHaveLength(2);
    expect(donutSlicePath(80, 80, 70, 45, 1, 1)).toBe("");
  });
});

describe("summarizeChart", () => {
  it("describes kind, points, series and value range", () => {
    const summary = summarizeChart({
      kind: "bar",
      title: "Primas por mes",
      unit: "$",
      labels: ["Ene", "Feb", "Mar"],
      seriesNames: ["2025", "2026"],
      min: 100,
      max: 2500
    });
    expect(summary).toBe("Gráfico de barras: Primas por mes. 3 puntos, de Ene a Mar. Series: 2025, 2026. Valores entre $100 y $2.500.");
  });

  it("does not break with no data", () => {
    expect(summarizeChart({ kind: "pie", title: "Vacío", labels: [], seriesNames: [], min: Number.NaN, max: Number.NaN })).toBe(
      "Gráfico de torta: Vacío."
    );
  });
});

describe("GestiChart", () => {
  const base = { title: "Pólizas por ramo", labels: ["Auto", "Hogar", "Vida"], series: [{ name: "Cantidad", values: [12, 5, 3] }] };

  it.each(["bar", "line", "area", "pie"] as const)("renders a %s chart with an accessible summary and a data table", (kind) => {
    const html = renderToStaticMarkup(createElement(GestiChart, { chart: { ...base, kind } satisfies ChartSpec }));
    expect(html).toContain("Pólizas por ramo");
    expect(html).toContain('role="img"');
    expect(html).toContain("gesti-sr-only");
    expect(html).toContain("<table");
  });

  it("renders a sortable table", () => {
    const chart: ChartSpec = {
      kind: "table",
      title: "Clientes",
      columns: ["Nombre", "Prima"],
      rows: [
        ["Ana", 1500],
        ["Beto", null]
      ]
    };
    const html = renderToStaticMarkup(createElement(GestiChart, { chart }));
    expect(html).toContain('aria-sort="none"');
    expect(html).toContain("1.500");
    expect(html).toContain("—");
  });

  it("shows an empty state instead of throwing on odd data", () => {
    const empty: ChartSpec = { kind: "bar", title: "Nada", labels: [], series: [] };
    expect(() => renderToStaticMarkup(createElement(GestiChart, { chart: empty }))).not.toThrow();
    const zeros: ChartSpec = { kind: "pie", title: "Ceros", labels: ["A", "B"], series: [{ name: "x", values: [0, 0] }] };
    expect(() => renderToStaticMarkup(createElement(GestiChart, { chart: zeros }))).not.toThrow();
    const single: ChartSpec = { kind: "line", title: "Uno", labels: ["A"], series: [{ name: "x", values: [4] }] };
    expect(() => renderToStaticMarkup(createElement(GestiChart, { chart: single }))).not.toThrow();
  });
});

describe("tableEntries", () => {
  const rows = [
    ["Bravo", 20],
    ["alfa", 5],
    ["Charlie", null],
    ["Delta", 100]
  ];
  const links: Array<ChartLink | null> = [
    { kind: "task", id: "t-bravo" },
    { kind: "task", id: "t-alfa" },
    null,
    { kind: "task", id: "t-delta" }
  ];

  it("keeps the original order and each row's link when there is no sort", () => {
    expect(tableEntries(rows, links, null).map((entry) => [entry.row[0], entry.link?.id ?? null])).toEqual([
      ["Bravo", "t-bravo"],
      ["alfa", "t-alfa"],
      ["Charlie", null],
      ["Delta", "t-delta"]
    ]);
  });

  it("sorts rows and carries the link of every row with it", () => {
    const sorted = tableEntries(rows, links, { column: 1, direction: "asc" });
    expect(sorted.map((entry) => entry.row[0])).toEqual(["alfa", "Bravo", "Delta", "Charlie"]);
    expect(sorted.map((entry) => entry.link?.id ?? null)).toEqual(["t-alfa", "t-bravo", "t-delta", null]);

    const desc = tableEntries(rows, links, { column: 0, direction: "desc" });
    expect(desc.map((entry) => [entry.row[0], entry.link?.id ?? null])).toEqual([
      ["Delta", "t-delta"],
      ["Charlie", null],
      ["Bravo", "t-bravo"],
      ["alfa", "t-alfa"]
    ]);
  });

  it("matches sortRows and tolerates missing or short link lists", () => {
    expect(tableEntries(rows, undefined, { column: 1, direction: "asc" }).map((entry) => entry.row)).toEqual(
      sortRows(rows, 1, "asc")
    );
    expect(tableEntries(rows, [links[0] ?? null], null).map((entry) => entry.link)).toEqual([links[0], null, null, null]);
  });

  it("gives identical rows their own links", () => {
    const twins = [["Igual"], ["Igual"]];
    const sorted = tableEntries(twins, [{ kind: "task", id: "uno" }, { kind: "task", id: "dos" }], { column: 0, direction: "desc" });
    expect(sorted.map((entry) => entry.link?.id)).toEqual(["uno", "dos"]);
  });
});

describe("recordLinkLabel", () => {
  it("names what the row opens and which record it is", () => {
    expect(recordLinkLabel("task", "Llamar a Ana")).toBe("Abrir tarea: Llamar a Ana");
    expect(recordLinkLabel("policy", "AU-123")).toBe("Abrir póliza: AU-123");
    expect(recordLinkLabel("notice", 30)).toBe("Abrir aviso de pago: 30");
    expect(recordLinkLabel("client", null)).toBe("Abrir asegurado");
    expect(recordLinkLabel("company", "  ")).toBe("Abrir compañía");
  });
});

describe("GestiChart table rows", () => {
  const table: ChartSpec = {
    kind: "table",
    title: "Tareas abiertas",
    columns: ["Tarea", "Vence"],
    rows: [
      ["Llamar a Ana", "20/10"],
      ["Sin registro", "21/10"],
      ["Renovar póliza", "22/10"]
    ],
    links: [{ kind: "task", id: "t1" }, null, { kind: "policy", id: "p1", clientId: "c1" }]
  };
  const render = (chart: ChartSpec, onOpenRecord?: (link: ChartLink) => void) =>
    renderToStaticMarkup(createElement(GestiChart, { chart, ...(onOpenRecord ? { onOpenRecord } : {}) }));
  const count = (html: string, text: string) => html.split(text).length - 1;

  it("makes only the rows with a link interactive, with a button and an accessible label", () => {
    const html = render(table, () => undefined);

    expect(count(html, 'data-interactive="true"')).toBe(2);
    expect(html).toContain('aria-label="Abrir tarea: Llamar a Ana"');
    expect(html).toContain('aria-label="Abrir póliza: Renovar póliza"');
    expect(count(html, 'class="gesti-chart-open"')).toBe(2);
  });

  it("keeps rows inert without a navigation callback (public demo)", () => {
    const html = render(table);

    expect(html).not.toContain("data-interactive");
    expect(html).not.toContain("gesti-chart-open");
    expect(html).not.toContain("Abrir ");
  });

  it("keeps rows inert when the table has no links", () => {
    const { links: _links, ...plain } = table;
    const html = render(plain, () => undefined);

    expect(html).not.toContain("data-interactive");
    expect(html).not.toContain("gesti-chart-open");
  });

  it("keeps non-table charts non-interactive even if they carry links", () => {
    const chart: ChartSpec = {
      kind: "bar",
      title: "Pólizas",
      labels: ["Auto"],
      series: [{ name: "Cantidad", values: [3] }],
      links: [{ kind: "policy", id: "p1", clientId: "c1" }]
    };
    const html = render(chart, () => undefined);

    expect(html).not.toContain("data-interactive");
    expect(html).not.toContain("gesti-chart-open");
  });
});

describe("recordDestination", () => {
  it("opens a task by id", () => {
    expect(recordDestination({ kind: "task", id: "t1" })).toEqual({ tab: "tasks", taskId: "t1" });
  });

  it("opens a policy, and a notice's policy, inside the client's detail", () => {
    expect(recordDestination({ kind: "policy", id: "p1", clientId: "c1" })).toEqual({ tab: "clients", clientId: "c1", policyId: "p1" });
    expect(recordDestination({ kind: "notice", id: "n1", policyId: "p1", clientId: "c1" })).toEqual({
      tab: "clients",
      clientId: "c1",
      policyId: "p1"
    });
  });

  it("opens a client's detail and the companies tab", () => {
    expect(recordDestination({ kind: "client", id: "c1" })).toEqual({ tab: "clients", clientId: "c1", policyId: null });
    expect(recordDestination({ kind: "company", id: "co1" })).toEqual({ tab: "companies" });
  });

  it("goes nowhere when the ids needed to open the record are missing", () => {
    expect(recordDestination({ kind: "policy", id: "p1" })).toBeNull();
    expect(recordDestination({ kind: "notice", id: "n1", clientId: "c1" })).toBeNull();
    expect(recordDestination({ kind: "notice", id: "n1", policyId: "p1" })).toBeNull();
  });
});
