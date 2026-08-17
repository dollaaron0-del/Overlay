import { useEffect, useId, useRef, useState } from "react";

// Renders a fenced ```mermaid block (flowcharts, sequence diagrams, etc.).
// mermaid is dynamically imported so it only loads into a separate chunk
// when a chat actually contains a diagram, not on every Emmy page load.

let mermaidPromise: Promise<typeof import("mermaid")> | null = null;
function loadMermaid() {
  mermaidPromise ??= import("mermaid");
  return mermaidPromise;
}

function isDarkTheme(): boolean {
  const stamped = document.documentElement.dataset.theme;
  if (stamped === "dark") return true;
  if (stamped === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
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
        mermaid.initialize({ startOnLoad: false, theme: isDarkTheme() ? "dark" : "default", securityLevel: "strict" });
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
        <p>⚠️ Diagramm fehlerhaft: {error}</p>
        <pre>
          <code>{code}</code>
        </pre>
      </div>
    );
  }

  return <div ref={containerRef} className="emmy2-mermaid" />;
}
