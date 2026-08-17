import { useEffect, useRef, useState } from "react";

// Renders a ```mermaid code block as an actual SVG diagram (flowcharts, trees,
// sequence diagrams, …) instead of a wall of text. Mermaid is loaded lazily
// since it's a large dependency and most Emmy replies won't use it.
let mermaidModulePromise: ReturnType<typeof loadMermaid> | undefined;

async function loadMermaid() {
  const mermaid = (await import("mermaid")).default;
  const isDark = document.documentElement.getAttribute("data-theme") !== "light";
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: isDark ? "dark" : "default",
    fontFamily: "inherit",
  });
  return mermaid;
}

let diagramCounter = 0;

export function MermaidDiagram({ code }: { code: string }) {
  const containerId = useRef(`emmy2-mermaid-${diagramCounter++}`);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    mermaidModulePromise = mermaidModulePromise ?? loadMermaid();
    mermaidModulePromise
      .then((mermaid) => mermaid.render(containerId.current, code))
      .then(({ svg: rendered }) => {
        if (!cancelled) setSvg(rendered);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (error) {
    return (
      <pre className="emmy2-mermaid-error">
        <code>{code}</code>
      </pre>
    );
  }
  if (!svg) {
    return <div className="emmy2-mermaid-loading">Diagramm wird geladen…</div>;
  }
  // svg is mermaid's own sanitized output (securityLevel "strict" runs it
  // through DOMPurify internally) — safe to inject directly.
  return <div className="emmy2-mermaid" dangerouslySetInnerHTML={{ __html: svg }} />;
}
