import { useEffect, useState } from "react";
import { api } from "../../api/client";

interface ModelStatus {
  configured: boolean;
  claudeCli: { label: string | null; limited: boolean | null; detail: string | null };
  gemini: { hasCapacity: boolean | null; detail: string | null };
  error?: string;
}

/**
 * Sidebar "Modelle" widget: which Claude CLI account is live and whether
 * Gemini still has capacity. Shows a "noch nicht verbunden" placeholder
 * until the gateway admin-http-rpc endpoint is configured server-side
 * (see server/src/system-models.ts).
 */
export function ModelStatusWidget() {
  const [status, setStatus] = useState<ModelStatus | null>(null);

  useEffect(() => {
    const fetchStatus = () =>
      api.get<ModelStatus>("/api/system/models").then(setStatus).catch(() => undefined);
    fetchStatus();
    const interval = setInterval(fetchStatus, 30_000);
    return () => clearInterval(interval);
  }, []);

  const notConnected = <span className="emmy2-model-muted">noch nicht verbunden</span>;

  const claudeValue = () => {
    if (!status || !status.configured) return notConnected;
    const parts: string[] = [];
    if (status.claudeCli.label) parts.push(status.claudeCli.label);
    if (status.claudeCli.limited === true) parts.push("Limit erreicht");
    else if (status.claudeCli.detail) parts.push(status.claudeCli.detail);
    return parts.length ? parts.join(" · ") : <span className="emmy2-model-muted">—</span>;
  };

  const geminiValue = () => {
    if (!status || !status.configured) return notConnected;
    if (status.gemini.hasCapacity === true) return "Kapazität frei";
    if (status.gemini.hasCapacity === false) return "erschöpft";
    return <span className="emmy2-model-muted">—</span>;
  };

  return (
    <div className="emmy2-model-widget">
      <div className="emmy2-model-row">
        <span className="emmy2-model-key">Claude CLI</span>
        <span className="emmy2-model-val">{claudeValue()}</span>
      </div>
      <div className="emmy2-model-row">
        <span className="emmy2-model-key">Gemini</span>
        <span className="emmy2-model-val">{geminiValue()}</span>
      </div>
    </div>
  );
}
