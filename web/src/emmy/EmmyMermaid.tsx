import { useEffect, useId, useRef, useState } from "react";

// Renders a fenced ```mermaid block (flowcharts, tree diagrams via
// `flowchart TD`, mindmaps, sequence diagrams, etc.). mermaid is dynamically
// imported so it only loads into a separate chunk when a chat actually
// contains a diagram, not on every Emmy page load. The diagram is themed
// from the live Emmy palette (CSS custom properties) via mermaid's "base"
// theme so nodes/edges match the overlay instead of mermaid's stock colours.

let mermaidPromise: Promise<typeof import("mermaid")> | null = null;
function loadMermaid() {
  mermaidPromise ??= import("mermaid");
  return mermaidPromise;
}

/** Reads a CSS custom property off :root, trimmed; falls back if unset. */
function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

const SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';

/** mermaid themeVariables built from the current Emmy palette. */
function emmyThemeVariables(): Record<string, string> {
  const series = [
    cssVar("--c-series-1", "#3987e5"),
    cssVar("--c-series-2", "#d95926"),
    cssVar("--c-series-3", "#199e70"),
    cssVar("--c-series-4", "#c98500"),
    cssVar("--c-series-5", "#d55181"),
    cssVar("--c-series-6", "#008300"),
    cssVar("--c-series-7", "#9085e9"),
    cssVar("--c-series-8", "#e66767"),
  ];
  const text = cssVar("--c-text", "#e6e9ef");
  const surface = cssVar("--c-surface", "#131722");
  const surface2 = cssVar("--c-surface-2", "#1c2333");
  const border = cssVar("--c-border-strong", "#2c3550");
  const line = cssVar("--c-text-3", "#6b7385");

  const vars: Record<string, string> = {
    fontFamily: SANS,
    fontSize: "14px",
    background: surface2,
    mainBkg: surface,
    primaryColor: surface,
    primaryTextColor: text,
    primaryBorderColor: border,
    secondaryColor: surface2,
    secondaryTextColor: text,
    secondaryBorderColor: border,
    tertiaryColor: surface,
    tertiaryTextColor: text,
    tertiaryBorderColor: border,
    lineColor: line,
    textColor: text,
    nodeBorder: border,
    nodeTextColor: text,
    clusterBkg: surface,
    clusterBorder: border,
    edgeLabelBackground: surface2,
    titleColor: text,
  };
  // Categorical scale — drives mindmap sections and other multi-colour
  // diagrams. Series colours in a fixed order, matching EmmyChart.
  series.forEach((c, i) => {
    vars[`cScale${i}`] = c;
    vars[`cScaleInv${i}`] = c;
    vars[`cScaleLabel${i}`] = "#f5f7fa";
  });
  return vars;
}

export function EmmyMermaid({ code }: { code: string }): JSX.Element {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadMermaid()
      .then(async ({ default: mermaid }) => {
        if (cancelled) return;
        mermaid.initialize({
          startOnLoad: false,
          theme: "base",
          themeVariables: emmyThemeVariables(),
          securityLevel: "strict",
          mindmap: { padding: 12 },
          flowchart: { htmlLabels: true, curve: "basis" },
        });
        const { svg } = await mermaid.render(`emmy-mermaid-${id}`, code);
        if (!cancelled && containerRef.current) containerRef.current.innerHTML = svg;
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Diagramm konnte nicht gerendert werden.");
      });
    return () => {
      cancelled = true;
    };
  }, [code, id]);

  if (error) {
    return (
      <div className="emmy2-mermaid-error">
        <p><kbd>[!]</kbd> Diagramm fehlerhaft: {error}</p>
        <pre>
          <code>{code}</code>
        </pre>
      </div>
    );
  }

  return <div ref={containerRef} className="emmy2-mermaid" />;
}
