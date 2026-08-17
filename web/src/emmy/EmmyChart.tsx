import { useId, useState } from "react";

// Renders a fenced ```chart block: a small JSON spec Emmy can emit inline in
// a reply for a magnitude-over-category or magnitude-over-time answer,
// instead of describing numbers in prose. One axis only (no dual y-scale —
// see AGENTS dataviz guidance), categorical color assigned by series index
// in a fixed order, never cycled.

export interface EmmyChartSeries {
  name?: string;
  data: { label: string; value: number }[];
}

export interface EmmyChartSpec {
  type: "bar" | "line";
  title?: string;
  series: EmmyChartSeries[];
}

const SERIES_COLOR_VARS = [
  "var(--c-series-1)",
  "var(--c-series-2)",
  "var(--c-series-3)",
  "var(--c-series-4)",
  "var(--c-series-5)",
  "var(--c-series-6)",
  "var(--c-series-7)",
  "var(--c-series-8)",
];

/** Parses and sanity-checks a chart code-block body; null if it isn't a usable spec. */
export function parseEmmyChartSpec(raw: string): EmmyChartSpec | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  if (obj.type !== "bar" && obj.type !== "line") return null;
  if (!Array.isArray(obj.series) || obj.series.length === 0) return null;
  const series: EmmyChartSeries[] = [];
  for (const s of obj.series) {
    if (typeof s !== "object" || s === null) return null;
    const rec = s as Record<string, unknown>;
    if (!Array.isArray(rec.data) || rec.data.length === 0) return null;
    const data: { label: string; value: number }[] = [];
    for (const point of rec.data) {
      if (typeof point !== "object" || point === null) return null;
      const p = point as Record<string, unknown>;
      if (typeof p.label !== "string" || typeof p.value !== "number" || !Number.isFinite(p.value)) return null;
      data.push({ label: p.label, value: p.value });
    }
    series.push({ name: typeof rec.name === "string" ? rec.name : undefined, data });
  }
  // Beyond 8 series there's no passing categorical order left (see dataviz
  // skill) — fold the rest into the last visible slot rather than cycling hues.
  const capped = series.length > 8 ? series.slice(0, 8) : series;
  return { type: obj.type, title: typeof obj.title === "string" ? obj.title : undefined, series: capped };
}

function niceMax(max: number): number {
  if (max <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  const normalized = max / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

export function EmmyChart({ spec }: { spec: EmmyChartSpec }): JSX.Element {
  const uid = useId();
  const [tableView, setTableView] = useState(false);
  const [hover, setHover] = useState<{ series: number; point: number } | null>(null);

  const labels = spec.series[0].data.map((d) => d.label);
  const maxValue = niceMax(Math.max(0, ...spec.series.flatMap((s) => s.data.map((d) => d.value))));
  const showLegend = spec.series.length >= 2;

  const width = 560;
  const height = spec.type === "bar" ? 220 : 200;
  const padLeft = 36;
  const padRight = 12;
  const padTop = spec.title ? 28 : 12;
  const padBottom = 28;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const toY = (v: number) => padTop + plotH - (v / maxValue) * plotH;

  return (
    <div className="emmy2-chart">
      <div className="emmy2-chart-toolbar">
        {spec.title && <span className="emmy2-chart-title">{spec.title}</span>}
        <button type="button" className="emmy2-chart-toggle" onClick={() => setTableView((v) => !v)}>
          {tableView ? "📈 Als Diagramm" : "📋 Als Tabelle"}
        </button>
      </div>

      {tableView ? (
        <table className="emmy2-chart-table">
          <thead>
            <tr>
              <th />
              {labels.map((l) => (
                <th key={l}>{l}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {spec.series.map((s, si) => (
              <tr key={si}>
                <th>{s.name ?? `Serie ${si + 1}`}</th>
                {s.data.map((d, pi) => (
                  <td key={pi}>{d.value}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <>
          <svg viewBox={`0 0 ${width} ${height}`} className="emmy2-chart-svg" role="img" aria-label={spec.title ?? "Diagramm"}>
            <line
              x1={padLeft}
              y1={padTop + plotH}
              x2={width - padRight}
              y2={padTop + plotH}
              className="emmy2-chart-axis"
            />
            {spec.type === "bar" ? (
              <BarPlot
                spec={spec}
                labels={labels}
                toY={toY}
                plotW={plotW}
                plotH={plotH}
                padLeft={padLeft}
                padTop={padTop}
                hover={hover}
                setHover={setHover}
                uid={uid}
              />
            ) : (
              <LinePlot
                spec={spec}
                labels={labels}
                toY={toY}
                plotW={plotW}
                padLeft={padLeft}
                hover={hover}
                setHover={setHover}
              />
            )}
          </svg>
          {showLegend && (
            <div className="emmy2-chart-legend">
              {spec.series.map((s, i) => (
                <span key={i} className="emmy2-chart-legend-item">
                  <span className="emmy2-chart-swatch" style={{ background: SERIES_COLOR_VARS[i % 8] }} />
                  {s.name ?? `Serie ${i + 1}`}
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function BarPlot({
  spec,
  labels,
  toY,
  plotW,
  plotH,
  padLeft,
  padTop,
  hover,
  setHover,
  uid,
}: {
  spec: EmmyChartSpec;
  labels: string[];
  toY: (v: number) => number;
  plotW: number;
  plotH: number;
  padLeft: number;
  padTop: number;
  hover: { series: number; point: number } | null;
  setHover: (h: { series: number; point: number } | null) => void;
  uid: string;
}): JSX.Element {
  const groupCount = labels.length;
  const seriesCount = spec.series.length;
  const groupGap = 12;
  const groupW = (plotW - groupGap * (groupCount - 1)) / groupCount;
  const barGap = 2; // surface gap between adjacent fills in the same group
  const barW = Math.max(4, (groupW - barGap * (seriesCount - 1)) / seriesCount);

  return (
    <>
      {labels.map((label, gi) => {
        const groupX = padLeft + gi * (groupW + groupGap);
        return (
          <g key={gi}>
            {spec.series.map((s, si) => {
              const value = s.data[gi]?.value ?? 0;
              const barX = groupX + si * (barW + barGap);
              const y = toY(value);
              const barH = Math.max(0, padTop + plotH - y);
              const isHovered = hover?.series === si && hover.point === gi;
              return (
                <g
                  key={si}
                  onMouseEnter={() => setHover({ series: si, point: gi })}
                  onMouseLeave={() => setHover(null)}
                >
                  <rect
                    x={barX}
                    y={y}
                    width={barW}
                    height={barH}
                    rx={4}
                    ry={4}
                    fill={SERIES_COLOR_VARS[si % 8]}
                    opacity={isHovered ? 1 : 0.92}
                  />
                  {barW >= 16 && (
                    <text x={barX + barW / 2} y={y - 4} textAnchor="middle" className="emmy2-chart-value-label">
                      {value}
                    </text>
                  )}
                  {isHovered && (
                    <title>
                      {(s.name ?? `Serie ${si + 1}`)}: {label} = {value}
                    </title>
                  )}
                </g>
              );
            })}
            <text x={groupX + groupW / 2} y={padTop + plotH + 16} textAnchor="middle" className="emmy2-chart-axis-label">
              {label}
            </text>
          </g>
        );
      })}
    </>
  );
}

function LinePlot({
  spec,
  labels,
  toY,
  plotW,
  padLeft,
  hover,
  setHover,
}: {
  spec: EmmyChartSpec;
  labels: string[];
  toY: (v: number) => number;
  plotW: number;
  padLeft: number;
  hover: { series: number; point: number } | null;
  setHover: (h: { series: number; point: number } | null) => void;
}): JSX.Element {
  const stepX = labels.length > 1 ? plotW / (labels.length - 1) : 0;
  const toX = (i: number) => padLeft + i * stepX;

  return (
    <>
      {spec.series.map((s, si) => {
        const d = s.data.map((point, i) => `${i === 0 ? "M" : "L"}${toX(i)},${toY(point.value)}`).join(" ");
        return (
          <g key={si}>
            <path d={d} fill="none" stroke={SERIES_COLOR_VARS[si % 8]} strokeWidth={2} />
            {s.data.map((point, pi) => {
              const isHovered = hover?.series === si && hover.point === pi;
              return (
                <circle
                  key={pi}
                  cx={toX(pi)}
                  cy={toY(point.value)}
                  r={isHovered ? 5 : 4}
                  fill={SERIES_COLOR_VARS[si % 8]}
                  onMouseEnter={() => setHover({ series: si, point: pi })}
                  onMouseLeave={() => setHover(null)}
                >
                  <title>
                    {(s.name ?? `Serie ${si + 1}`)}: {point.label} = {point.value}
                  </title>
                </circle>
              );
            })}
          </g>
        );
      })}
      {labels.map((label, i) => (
        <text key={i} x={toX(i)} y={toY(0) + 16} textAnchor="middle" className="emmy2-chart-axis-label">
          {label}
        </text>
      ))}
    </>
  );
}
