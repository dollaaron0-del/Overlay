import { useEffect, useRef, useState } from "react";

// Renders a $$...$$ math block via KaTeX. Both the library and its stylesheet
// are dynamically imported — katex is already one of mermaid's own
// dependencies (see MERMAID_CHUNK_DEPS in vite.config.ts), so this reaches
// the same on-demand vendor chunk instead of adding bytes to the initial load.
let katexPromise: Promise<typeof import("katex")> | null = null;
function loadKatex() {
  katexPromise ??= Promise.all([import("katex"), import("katex/dist/katex.min.css")]).then(([mod]) => mod);
  return katexPromise;
}

export function EmmyMath({ latex }: { latex: string }): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadKatex()
      .then(({ default: katex }) => {
        if (cancelled || !containerRef.current) return;
        containerRef.current.innerHTML = katex.renderToString(latex, { throwOnError: true, displayMode: true });
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Formel konnte nicht gerendert werden.");
      });
    return () => {
      cancelled = true;
    };
  }, [latex]);

  if (error) {
    return (
      <div className="emmy2-math-error">
        <p>⚠️ Formel fehlerhaft: {error}</p>
        <pre>
          <code>{latex}</code>
        </pre>
      </div>
    );
  }

  return <div ref={containerRef} className="emmy2-math" />;
}
