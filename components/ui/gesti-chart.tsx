"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  badgeTone,
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
  summarizeChart,
  tableEntries,
  truncateLabel,
  type ChartCell,
  type SortDirection
} from "@/lib/gesti-chart-format";
import type { ChartCard, ChartLink, ChartSpec } from "@/lib/gesti-parts";

// Gráficos de Gesti dentro de un mensaje del asistente (S6). SVG propio, sin
// librerías de gráficos. Estilos en app/gesti-chart.css.

const PALETTE_SIZE = 6;
const FALLBACK_WIDTH = 640;
const MARGIN_TOP = 12;
const MARGIN_RIGHT = 14;
const TICK_CHAR_WIDTH = 6.2;
const MAX_X_LABEL_CHARS = 18;
const MAX_BAR_WIDTH = 28;

const valueAt = (item: NormalizedSeries, position: number) => item.values[position] ?? 0;

function seriesColor(index: number) {
  return `var(--gesti-chart-${(index % PALETTE_SIZE) + 1})`;
}

type NormalizedSeries = { index: number; name: string; values: number[] };

type ChartData = {
  kind: "bar" | "line" | "area" | "pie";
  title: string;
  unit?: string | undefined;
  labels: string[];
  series: NormalizedSeries[];
};

/** Ancho real del contenedor: el viewBox lo usa tal cual y el texto no se escala. */
function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(FALLBACK_WIDTH);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const next = Math.round(node.clientWidth);
      if (next > 0) setWidth(next);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

export function GestiChart({
  chart,
  onOpenRecord
}: {
  chart: ChartSpec;
  /** Abre el registro de una fila de tabla. Sin esto (demo pública) las filas no son clickeables. */
  onOpenRecord?: ((link: ChartLink) => void) | undefined;
}) {
  return (
    <figure className="gesti-chart" data-kind={chart.kind}>
      <figcaption className="gesti-chart-head">
        <span className="gesti-chart-title">{chart.title}</span>
        {chart.subtitle ? <span className="gesti-chart-subtitle">{chart.subtitle}</span> : null}
      </figcaption>
      {chart.kind === "table" ? (
        <ChartTable chart={chart} onOpenRecord={onOpenRecord} />
      ) : chart.kind === "cards" ? (
        <ChartCards chart={chart} onOpenRecord={onOpenRecord} />
      ) : chart.kind === "stats" ? (
        <ChartStats chart={chart} />
      ) : (
        <ChartBody chart={chart} />
      )}
    </figure>
  );
}

function ChartBody({ chart }: { chart: ChartSpec }) {
  const labels = chart.labels ?? [];
  const series: NormalizedSeries[] = (chart.series ?? []).map((item, index) => ({
    index,
    name: item.name,
    values: labels.map((_, position) => {
      const value = item.values[position];
      return typeof value === "number" && Number.isFinite(value) ? value : 0;
    })
  }));
  if (labels.length === 0 || series.length === 0 || chart.kind === "table" || chart.kind === "cards" || chart.kind === "stats") {
    return <p className="gesti-chart-empty">Sin datos para mostrar.</p>;
  }
  const data: ChartData = { kind: chart.kind, title: chart.title, unit: chart.unit, labels, series };
  return data.kind === "pie" ? <PieChart data={data} /> : <CartesianChart data={data} />;
}

// ---------- Tabla de datos para lectores de pantalla ----------

function ScreenReaderTable({ data }: { data: ChartData }) {
  const pie = data.kind === "pie";
  const first = data.series[0];
  const total = first ? first.values.reduce((sum, value) => sum + Math.max(0, value), 0) : 0;
  return (
    <table className="gesti-sr-only">
      <caption>{data.title}</caption>
      <thead>
        <tr>
          <th scope="col">Categoría</th>
          {pie ? (
            <>
              <th scope="col">{first?.name ?? "Valor"}</th>
              <th scope="col">Porcentaje</th>
            </>
          ) : (
            data.series.map((item) => (
              <th key={item.index} scope="col">
                {item.name}
              </th>
            ))
          )}
        </tr>
      </thead>
      <tbody>
        {data.labels.map((label, position) => (
          <tr key={position}>
            <th scope="row">{label}</th>
            {pie ? (
              <>
                <td>{formatValue(first?.values[position] ?? 0, data.unit)}</td>
                <td>{total > 0 ? formatPercent(Math.max(0, first?.values[position] ?? 0) / total) : formatPercent(0)}</td>
              </>
            ) : (
              data.series.map((item) => <td key={item.index}>{formatValue(valueAt(item, position), data.unit)}</td>)
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------- Barras, líneas y áreas ----------

function CartesianChart({ data }: { data: ChartData }) {
  const { kind, unit, labels } = data;
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [hidden, setHidden] = useState<number[]>([]);
  const [active, setActive] = useState<number | null>(null);

  const visible = data.series.filter((item) => !hidden.includes(item.index));
  const shown = visible.length > 0 ? visible : data.series;
  const all = shown.flatMap((item) => item.values);
  const dataMin = all.length > 0 ? Math.min(...all) : 0;
  const dataMax = all.length > 0 ? Math.max(...all) : 0;
  const scale = niceTicks(dataMin, dataMax, { includeZero: shouldIncludeZero(kind as "bar" | "line" | "area", dataMin, dataMax) });
  const compact = shouldCompact(Math.max(Math.abs(scale.min), Math.abs(scale.max)));
  const tickText = scale.ticks.map((tick) => formatValue(tick, unit, { compact }));

  const w = Math.max(width, 240);
  const h = w < 420 ? 220 : 264;
  const left = Math.max(36, Math.max(...tickText.map((text) => text.length)) * TICK_CHAR_WIDTH + 14);
  const plotW = Math.max(40, w - left - MARGIN_RIGHT);
  const count = labels.length;
  const band = plotW / count;
  const longest = Math.min(MAX_X_LABEL_CHARS, Math.max(...labels.map((label) => Array.from(label).length)));
  const plan = planXLabels(count, plotW, longest);
  const bottom = plan.rotate ? 16 + Math.min(longest, 14) * 3.6 : 30;
  const plotH = Math.max(60, h - MARGIN_TOP - bottom);
  const span = scale.max - scale.min || 1;
  const yOf = (value: number) => MARGIN_TOP + plotH * (1 - (value - scale.min) / span);
  const xOf = (position: number) => left + band * (position + 0.5);
  const baseline = yOf(Math.min(Math.max(0, scale.min), scale.max));
  const slotChars = Math.floor((band * plan.step - 6) / TICK_CHAR_WIDTH);
  const labelChars = plan.rotate ? 14 : Math.max(3, Math.min(MAX_X_LABEL_CHARS, slotChars));

  const summary = summarizeChart({
    kind,
    title: data.title,
    unit,
    labels,
    seriesNames: data.series.map((item) => item.name),
    min: Math.min(...data.series.flatMap((item) => item.values)),
    max: Math.max(...data.series.flatMap((item) => item.values))
  });

  const toggleSeries = (index: number) => {
    setHidden((current) => {
      if (current.includes(index)) return current.filter((item) => item !== index);
      // Siempre queda al menos una serie a la vista.
      return visible.length <= 1 ? current : [...current, index];
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = count - 1;
    let next: number | null | undefined;
    if (event.key === "ArrowRight") next = active === null ? 0 : Math.min(last, active + 1);
    else if (event.key === "ArrowLeft") next = active === null ? last : Math.max(0, active - 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    else if (event.key === "Escape") next = null;
    if (next === undefined) return;
    event.preventDefault();
    setActive(next);
  };

  const activeX = active === null ? 0 : xOf(active);
  const activeLines =
    active === null
      ? ""
      : `${labels[active]}: ${shown.map((item) => `${item.name} ${formatValue(valueAt(item, active), unit)}`).join(", ")}`;
  const barCount = shown.length;
  const barWidth = Math.max(2, Math.min(MAX_BAR_WIDTH, (band * 0.72) / barCount));

  return (
    <>
      <div
        ref={ref}
        className="gesti-chart-plot"
        tabIndex={0}
        role="group"
        aria-label={`${data.title}. Con las flechas izquierda y derecha recorrés los datos.`}
        onKeyDown={onKeyDown}
        onFocus={() => setActive((current) => current ?? 0)}
        onBlur={() => setActive(null)}
        onPointerLeave={(event) => {
          if (event.pointerType === "mouse") setActive(null);
        }}
      >
        <svg className="gesti-chart-svg" role="img" aria-label={summary} viewBox={`0 0 ${w} ${h}`} width="100%" height={h}>
          {scale.ticks.map((tick, position) => (
            <g key={tick}>
              <line className="gesti-chart-grid" x1={left} x2={left + plotW} y1={yOf(tick)} y2={yOf(tick)} />
              <text className="gesti-chart-tick" x={left - 8} y={yOf(tick)} dy="0.32em" textAnchor="end">
                {tickText[position]}
              </text>
            </g>
          ))}
          <line className="gesti-chart-zero" x1={left} x2={left + plotW} y1={baseline} y2={baseline} />

          {active !== null && kind === "bar" ? (
            <rect className="gesti-chart-focus-band" x={left + band * active} y={MARGIN_TOP} width={band} height={plotH} />
          ) : null}
          {active !== null && kind !== "bar" ? (
            <line className="gesti-chart-cursor" x1={activeX} x2={activeX} y1={MARGIN_TOP} y2={MARGIN_TOP + plotH} />
          ) : null}

          {kind === "bar"
            ? labels.map((_, position) =>
                shown.map((item, slot) => {
                  const value = valueAt(item, position);
                  if (value === 0) return null;
                  const x = xOf(position) - (barWidth * barCount) / 2 + barWidth * slot;
                  const top = Math.min(yOf(value), baseline);
                  return (
                    <rect
                      key={`${item.index}-${position}`}
                      className="gesti-chart-bar"
                      x={x + 1}
                      y={top}
                      width={Math.max(1, barWidth - 2)}
                      height={Math.max(1, Math.abs(yOf(value) - baseline))}
                      rx={Math.min(3, barWidth / 2)}
                      style={{
                        fill: seriesColor(item.index),
                        transformOrigin: value >= 0 ? "50% 100%" : "50% 0%",
                        animationDelay: `${Math.min(position, 20) * 22}ms`
                      }}
                    />
                  );
                })
              )
            : shown.map((item) => {
                const points = item.values.map((value, position) => `${round(xOf(position))} ${round(yOf(value))}`);
                const line = `M${points.join("L")}`;
                return (
                  <g key={item.index} style={{ color: seriesColor(item.index) }}>
                    {kind === "area" ? (
                      <path
                        className="gesti-chart-area"
                        d={`${line}L${round(xOf(count - 1))} ${round(baseline)}L${round(xOf(0))} ${round(baseline)}Z`}
                      />
                    ) : null}
                    {count > 1 ? <path className="gesti-chart-line" d={line} pathLength={1} /> : null}
                    {count === 1 || count <= 24
                      ? item.values.map((value, position) => (
                          <circle key={position} className="gesti-chart-dot" cx={xOf(position)} cy={yOf(value)} r={3} />
                        ))
                      : null}
                    {active !== null ? (
                      <circle className="gesti-chart-dot-active" cx={activeX} cy={yOf(valueAt(item, active))} r={5} />
                    ) : null}
                  </g>
                );
              })}

          {labels.map((label, position) =>
            position % plan.step === 0 ? (
              <text
                key={position}
                className="gesti-chart-tick"
                x={xOf(position)}
                y={MARGIN_TOP + plotH + (plan.rotate ? 12 : 17)}
                textAnchor={plan.rotate ? "end" : "middle"}
                transform={plan.rotate ? `rotate(-35 ${round(xOf(position))} ${MARGIN_TOP + plotH + 12})` : undefined}
                data-active={active === position}
              >
                {truncateLabel(label, labelChars)}
              </text>
            ) : null
          )}

          {labels.map((label, position) => (
            <rect
              key={position}
              className="gesti-chart-hit"
              x={left + band * position}
              y={MARGIN_TOP}
              width={band}
              height={plotH}
              data-label={label}
              onPointerEnter={(event) => {
                if (event.pointerType === "mouse") setActive(position);
              }}
              onPointerDown={() => setActive(position)}
            />
          ))}
        </svg>

        {active !== null ? (
          <div
            className="gesti-chart-tooltip"
            aria-hidden="true"
            data-side={activeX > w / 2 ? "left" : "right"}
            style={{ left: activeX, top: MARGIN_TOP + 4 }}
          >
            <strong>{labels[active]}</strong>
            {shown.map((item) => (
              <span key={item.index} className="gesti-chart-tooltip-row">
                <i style={{ background: seriesColor(item.index) }} />
                <span>{item.name}</span>
                <b>{formatValue(valueAt(item, active), unit)}</b>
              </span>
            ))}
          </div>
        ) : null}
        <div className="gesti-sr-only" aria-live="polite">
          {activeLines}
        </div>
      </div>

      {data.series.length > 1 ? (
        <ul className="gesti-chart-legend" aria-label="Series">
          {data.series.map((item) => {
            const isVisible = !hidden.includes(item.index);
            return (
              <li key={item.index}>
                <button type="button" className="gesti-chart-legend-item" aria-pressed={isVisible} onClick={() => toggleSeries(item.index)}>
                  <i style={{ background: seriesColor(item.index) }} />
                  {item.name}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      <ScreenReaderTable data={data} />
    </>
  );
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}

// ---------- Torta (dona) ----------

const DONUT_SIZE = 160;
const DONUT_OUTER = 74;
const DONUT_INNER = 48;

function PieChart({ data }: { data: ChartData }) {
  const { unit } = data;
  const [active, setActive] = useState<number | null>(null);
  const source = data.series[0];
  if (!source) return null;
  const slices = groupSlices(data.labels, source.values);
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const center = DONUT_SIZE / 2;

  let cursor = 0;
  const arcs = slices.map((slice) => {
    const sweep = total > 0 ? (slice.value / total) * Math.PI * 2 : 0;
    const arc = { start: cursor, end: cursor + sweep };
    cursor += sweep;
    return arc;
  });
  const activeSlice = active === null ? null : slices[active];

  const summary = summarizeChart({
    kind: "pie",
    title: data.title,
    unit,
    labels: data.labels,
    seriesNames: [source.name],
    min: Math.min(...source.values),
    max: Math.max(...source.values)
  });

  return (
    <>
      <div className="gesti-chart-pie" onPointerLeave={(event) => event.pointerType === "mouse" && setActive(null)}>
        <svg
          className="gesti-chart-donut"
          role="img"
          aria-label={summary}
          viewBox={`0 0 ${DONUT_SIZE} ${DONUT_SIZE}`}
          width={DONUT_SIZE}
          height={DONUT_SIZE}
        >
          {total === 0 ? (
            <circle
              className="gesti-chart-donut-empty"
              cx={center}
              cy={center}
              r={(DONUT_OUTER + DONUT_INNER) / 2}
              strokeWidth={DONUT_OUTER - DONUT_INNER}
            />
          ) : (
            slices.map((slice, position) =>
              slice.value > 0 ? (
                <path
                  key={position}
                  className="gesti-chart-slice"
                  d={donutSlicePath(center, center, DONUT_OUTER, DONUT_INNER, arcs[position]?.start ?? 0, arcs[position]?.end ?? 0)}
                  data-active={active === position}
                  data-dim={active !== null && active !== position}
                  style={{ fill: seriesColor(position), animationDelay: `${position * 60}ms` }}
                  onPointerEnter={(event) => event.pointerType === "mouse" && setActive(position)}
                  onPointerDown={() => setActive(position)}
                />
              ) : null
            )
          )}
          <text className="gesti-chart-donut-caption" x={center} y={center - 8} textAnchor="middle">
            {activeSlice ? truncateLabel(activeSlice.label, 16) : "Total"}
          </text>
          <text className="gesti-chart-donut-value" x={center} y={center + 12} textAnchor="middle">
            {formatValue(activeSlice ? activeSlice.value : total, unit, { compact: shouldCompact(activeSlice ? activeSlice.value : total) })}
          </text>
        </svg>

        <ul className="gesti-chart-pie-legend">
          {slices.map((slice, position) => (
            <li key={position}>
              <button
                type="button"
                className="gesti-chart-pie-row"
                aria-pressed={active === position}
                data-active={active === position}
                onFocus={() => setActive(position)}
                onBlur={() => setActive(null)}
                onPointerEnter={(event) => event.pointerType === "mouse" && setActive(position)}
                onClick={() => setActive((current) => (current === position ? null : position))}
              >
                <i style={{ background: seriesColor(position) }} />
                <span className="gesti-chart-pie-name">{slice.label}</span>
                <span className="gesti-chart-pie-value">{formatValue(slice.value, unit)}</span>
                <span className="gesti-chart-pie-share">{formatPercent(total > 0 ? slice.value / total : 0)}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <ScreenReaderTable data={data} />
    </>
  );
}

// ---------- Tabla ----------

function firstCell(row: ChartCell[]) {
  return row.find((cell) => cell !== null && String(cell).trim() !== "") ?? null;
}

function ChartTable({
  chart,
  onOpenRecord
}: {
  chart: ChartSpec;
  onOpenRecord: ((link: ChartLink) => void) | undefined;
}) {
  const columns = chart.columns ?? [];
  const rows = chart.rows ?? [];
  const [sort, setSort] = useState<{ column: number; direction: SortDirection } | null>(null);

  const numeric = columns.map((_, column) => isNumericColumn(rows, column));
  // Cada fila viaja con su enlace: ordenar la tabla no cambia a qué registro abre.
  const entries = tableEntries(rows, chart.links, sort);
  const open = onOpenRecord && entries.some((entry) => entry.link) ? onOpenRecord : null;

  if (columns.length === 0) return <p className="gesti-chart-empty">Sin datos para mostrar.</p>;

  const toggleSort = (column: number) => {
    setSort((current) =>
      current?.column === column ? { column, direction: current.direction === "asc" ? "desc" : "asc" } : { column, direction: "asc" }
    );
  };

  return (
    <div className="gesti-chart-scroll" tabIndex={0} role="region" aria-label={chart.title}>
      <table className="gesti-chart-table">
        <thead>
          <tr>
            {columns.map((column, position) => {
              const direction = sort?.column === position ? sort.direction : null;
              const Icon = direction === "asc" ? ArrowUp : direction === "desc" ? ArrowDown : ArrowUpDown;
              return (
                <th
                  key={position}
                  scope="col"
                  className={numeric[position] ? "is-number" : undefined}
                  aria-sort={direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none"}
                >
                  <button type="button" className="gesti-chart-sort" onClick={() => toggleSort(position)}>
                    <span>{column}</span>
                    <Icon size={13} aria-hidden="true" data-sorted={direction !== null} />
                  </button>
                </th>
              );
            })}
            {open ? (
              <th scope="col" className="gesti-chart-open-head">
                <span className="gesti-sr-only">Abrir</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {entries.map(({ row, link, index }) => (
            // El clic en la fila es comodidad con el mouse; con teclado y lector de pantalla se usa el botón.
            <tr
              key={index}
              data-interactive={open && link ? "true" : undefined}
              onClick={open && link ? () => open(link) : undefined}
            >
              {columns.map((_, position) => {
                const cell = row[position] ?? null;
                return (
                  <td key={position} className={numeric[position] ? "is-number" : undefined}>
                    {cell === null ? "—" : typeof cell === "number" ? formatNumber(cell) : cell}
                  </td>
                );
              })}
              {open ? (
                <td className="gesti-chart-open-cell">
                  {link ? (
                    <button type="button" className="gesti-chart-open" aria-label={recordLinkLabel(link.kind, firstCell(row))}>
                      <ChevronRight size={15} aria-hidden="true" />
                    </button>
                  ) : null}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- Cards ----------

function CardContent({ card, openLabel }: { card: ChartCard; openLabel: string | null }) {
  const fields = card.fields ?? [];
  return (
    <>
      <span className="gesti-card-head">
        <span className="gesti-card-title">{card.title}</span>
        {card.badge ? (
          <span className="gesti-card-badge" data-tone={badgeTone(card.badge)}>
            {card.badge}
          </span>
        ) : null}
      </span>
      {card.subtitle ? <span className="gesti-card-subtitle">{card.subtitle}</span> : null}
      {fields.length > 0 ? (
        <span className="gesti-card-fields">
          {fields.map((field, position) => (
            <span key={position} className="gesti-card-field">
              <span className="gesti-card-label">{field.label}</span>
              <span className="gesti-card-value">{typeof field.value === "number" ? formatNumber(field.value) : field.value}</span>
            </span>
          ))}
        </span>
      ) : null}
      {openLabel ? (
        <span className="gesti-card-open" aria-hidden="true">
          {openLabel}
          <ChevronRight size={14} />
        </span>
      ) : null}
    </>
  );
}

function ChartCards({
  chart,
  onOpenRecord
}: {
  chart: ChartSpec;
  onOpenRecord: ((link: ChartLink) => void) | undefined;
}) {
  const cards = chart.cards ?? [];
  if (cards.length === 0) return <p className="gesti-chart-empty">Sin datos para mostrar.</p>;

  return (
    <ul className="gesti-cards">
      {cards.map((card, index) => {
        const link = chart.links?.[index] ?? null;
        // Sin callback (demo pública) o sin destino posible, la card es solo lectura.
        const open = onOpenRecord && link && recordDestination(link) ? { link, onOpenRecord } : null;
        return (
          <li key={index}>
            {open ? (
              <button
                type="button"
                className="gesti-card"
                data-interactive="true"
                // Sin aria-label: el lector lee la card entera, con "Abrir …" al final.
                onClick={() => open.onOpenRecord(open.link)}
              >
                <CardContent card={card} openLabel={recordLinkLabel(open.link.kind, null)} />
              </button>
            ) : (
              <div className="gesti-card">
                <CardContent card={card} openLabel={null} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ---------- Cifras ----------

function ChartStats({ chart }: { chart: ChartSpec }) {
  const items = chart.items ?? [];
  if (items.length === 0) return <p className="gesti-chart-empty">Sin datos para mostrar.</p>;

  return (
    <ul className="gesti-stats">
      {items.map((item, index) => (
        <li key={index} className="gesti-stat">
          <span className="gesti-stat-label">{item.label}</span>
          <span className="gesti-stat-value">
            {typeof item.value === "number" ? formatValue(item.value, chart.unit) : item.value}
          </span>
          {item.hint ? <span className="gesti-stat-hint">{item.hint}</span> : null}
        </li>
      ))}
    </ul>
  );
}
