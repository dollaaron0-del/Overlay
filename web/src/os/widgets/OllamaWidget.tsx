import { useEffect, useState } from "react";
import { api } from "../../api/client";

interface OllamaStatus {
  configured: boolean;
  reachable?: boolean;
  model?: string;
  modelInstalled?: boolean;
  error?: string;
}

export function OllamaWidget({ onOpen }: { onOpen: () => void }) {
  const [ollama, setOllama] = useState<OllamaStatus | null>(null);

  useEffect(() => {
    api
      .get<OllamaStatus>("/api/security/ollama-status")
      .then(setOllama)
      .catch(() => undefined);
  }, []);

  return (
    <div className="os-widget" onClick={onOpen} role="button">
      <h3>Ollama (LLM-Triage)</h3>
      {!ollama && <p className="empty-hint">Lädt…</p>}
      {ollama && !ollama.configured && (
        <p className="empty-hint">Nicht konfiguriert (OLLAMA_MODEL leer) — Scan läuft ohne LLM-Einschätzung.</p>
      )}
      {ollama?.configured && (
        <p className={ollama.reachable ? "overview-ollama-ok" : "overview-ollama-error"}>
          {ollama.reachable
            ? `Erreichbar — Modell "${ollama.model}" ${ollama.modelInstalled ? "installiert" : "NICHT installiert"}`
            : `Nicht erreichbar (${ollama.error})`}
        </p>
      )}
    </div>
  );
}
