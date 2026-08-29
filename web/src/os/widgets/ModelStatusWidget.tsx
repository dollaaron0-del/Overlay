import { useEffect, useState } from "react";
import { api } from "../../api/client";

interface ModelLane {
  key: "default" | "recurring" | "research";
  label: string;
  model: string | null;
  fallback: string | null;
}

interface ModelStatus {
  lanes: ModelLane[];
  instance: {
    name: string;
    claudeAccounts: number;
    geminiKeys: number;
    generatedAt: string;
    ageSeconds: number;
    stale: boolean;
  } | null;
}

/** "anthropic/claude-sonnet-5" -> "Claude Sonnet 5"; "google/gemini-3.1-flash" -> "Gemini 3.1 Flash". */
function prettyModel(id: string | null): string {
  if (!id) return "—";
  const bare = id.includes("/") ? id.slice(id.indexOf("/") + 1) : id;
  return bare
    .replace(/^claude-/, "Claude ")
    .replace(/^gemini-/, "Gemini ")
    .replace(/^gpt-/, "GPT-")
    .replace(/-/g, " ")
    .replace(/\b(\w)/g, (m) => m.toUpperCase())
    .replace(/\bAi\b/, "AI");
}

function relAge(seconds: number): string {
  if (seconds < 90) return "gerade eben";
  if (seconds < 3600) return `vor ${Math.round(seconds / 60)} min`;
  return `vor ${Math.round(seconds / 3600)} h`;
}

/**
 * Sidebar-"Modelle"-Widget: welches Modell in welcher Emmy-Spur läuft
 * (Standard-Chat / wiederkehrende Checks / tiefe Recherche) plus eine
 * knappe, secret-freie Konten-Übersicht der Emmy-Instanz. Datenquelle:
 * GET /api/system/models (server/src/system-models.ts).
 */
export function ModelStatusWidget() {
  const [status, setStatus] = useState<ModelStatus | null>(null);

  useEffect(() => {
    const fetchStatus = () =>
      api.get<ModelStatus>("/api/system/models").then(setStatus).catch(() => undefined);
    fetchStatus();
    const interval = setInterval(fetchStatus, 60_000);
    return () => clearInterval(interval);
  }, []);

  if (!status) {
    return <div className="emmy2-model-widget emmy2-model-muted">lädt…</div>;
  }

  return (
    <div className="emmy2-model-widget">
      {status.lanes.map((lane) => (
        <div key={lane.key} className="emmy2-model-row">
          <span className="emmy2-model-key">{lane.label}</span>
          <span className="emmy2-model-val">
            {prettyModel(lane.model)}
            {lane.fallback ? (
              <span className="emmy2-model-muted"> · Fallback {prettyModel(lane.fallback)}</span>
            ) : null}
          </span>
        </div>
      ))}
      {status.instance ? (
        <div className="emmy2-model-foot">
          {status.instance.claudeAccounts} Claude-Konto{status.instance.claudeAccounts === 1 ? "" : "s"} ·{" "}
          {status.instance.geminiKeys} Gemini-Key{status.instance.geminiKeys === 1 ? "" : "s"}
          {status.instance.stale ? (
            <span className="emmy2-model-stale"> · Stand veraltet</span>
          ) : (
            <span className="emmy2-model-muted"> · {relAge(status.instance.ageSeconds)}</span>
          )}
        </div>
      ) : null}
    </div>
  );
}
