import { useEffect, useState } from "react";
import type { LlmTriage, ScanReport, ToolResult } from "@overlay/shared";
import { api, ApiError } from "../api/client";
import { formatTimestamp } from "../format";
import { SEVERITY_LABEL, SEVERITY_ORDER, isAllClear, type ScanSummary } from "./severity";
import { SeverityBadge } from "./SeverityBadge";

const TOOL_LABEL: Record<string, string> = {
  clamav: "ClamAV (Malware)",
  rkhunter: "rkhunter (Rootkits)",
  chkrootkit: "chkrootkit (Rootkits)",
  lynis: "Lynis (System-Audit)",
  aide: "AIDE (Datei-Integrität)",
  trivy: "Trivy (OS-Paket-CVEs)",
  "npm-audit": "npm audit (App-Abhängigkeiten)",
  "listening-ports": "Offene Ports",
};

const STATUS_LABEL: Record<ToolResult["status"], string> = {
  ok: "unauffällig",
  findings: "Funde",
  error: "Fehler beim Ausführen",
  skipped: "übersprungen (nicht installiert)",
};

function ToolResultCard({ tool }: { tool: ToolResult }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className={`tool-result-card tool-status-${tool.status}`}>
      <div className="tool-result-header">
        <span className="tool-name">{TOOL_LABEL[tool.tool] ?? tool.tool}</span>
        <span className={`tool-status-badge tool-status-${tool.status}`}>{STATUS_LABEL[tool.status]}</span>
      </div>
      {tool.note && <div className="tool-note">{tool.note}</div>}
      {tool.findings.length > 0 && (
        <ul className="finding-list">
          {tool.findings.map((finding, i) => (
            <li key={i} className={`finding-row severity-${finding.severity}`}>
              <span className={`severity-badge severity-${finding.severity}`}>
                {SEVERITY_LABEL[finding.severity]}
              </span>
              <span className="finding-message">{finding.message}</span>
              {finding.context && <span className="finding-context">{finding.context}</span>}
            </li>
          ))}
        </ul>
      )}
      {tool.raw && (
        <details className="tool-raw" open={expanded} onToggle={(e) => setExpanded(e.currentTarget.open)}>
          <summary>Rohausgabe anzeigen</summary>
          <pre>{tool.raw}</pre>
        </details>
      )}
    </div>
  );
}

function LlmTriageCard({ triage }: { triage: LlmTriage }) {
  if (triage.status === "skipped") {
    // Not configured / Ollama unreachable — quiet, not an error state worth alarming over.
    return null;
  }
  return (
    <div className="llm-triage-card">
      <div className="llm-triage-header">
        <span>🤖 Automatische Einschätzung {triage.model ? `(${triage.model})` : ""}</span>
        <span className="llm-triage-disclaimer">Von einer KI erzeugt — kann Fehler enthalten, ersetzt keine der Funde unten</span>
      </div>
      {triage.status === "ok" && <p className="llm-triage-text">{triage.text}</p>}
      {triage.status === "error" && <p className="llm-triage-error">Einschätzung fehlgeschlagen: {triage.note}</p>}
    </div>
  );
}

export function SecurityDashboard() {
  const [history, setHistory] = useState<ScanSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [report, setReport] = useState<ScanReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<ScanSummary[]>("/api/security/scans")
      .then(setHistory)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const path = selectedId ? `/api/security/scans/${selectedId}` : "/api/security/scans/latest";
    api
      .get<ScanReport>(path)
      .then(setReport)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) {
          setReport(null);
        } else {
          setError("Scan-Bericht konnte nicht geladen werden.");
        }
      })
      .finally(() => setLoading(false));
  }, [selectedId]);

  return (
    <div className="security-dashboard">
      <div className="security-history">
        <h3>Verlauf</h3>
        {history.length === 0 && <p className="empty-hint">Noch keine Scans gelaufen.</p>}
        <ul className="security-history-list">
          {history.map((entry) => (
            <li
              key={entry.id}
              className={entry.id === (selectedId ?? history[0]?.id) ? "selected" : ""}
              onClick={() => setSelectedId(entry.id)}
            >
              <div>{formatTimestamp(entry.startedAt)}</div>
              <div className="severity-summary-inline">
                {SEVERITY_ORDER.map((sev) => (
                  <SeverityBadge key={sev} severity={sev} count={entry.summary[sev]} />
                ))}
                {isAllClear(entry.summary) && (
                  <span className="severity-badge severity-ok">unauffällig</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="security-detail">
        {loading && <p className="empty-hint">Lädt…</p>}
        {error && <p className="file-viewer-error">{error}</p>}
        {!loading && !error && !report && (
          <p className="empty-hint">
            Noch kein Sicherheits-Scan gelaufen. Der nächtliche Scan läuft automatisch, sobald er auf dem
            Server eingerichtet ist (siehe docs/DEPLOYMENT.md).
          </p>
        )}
        {report && (
          <>
            <div className="security-detail-header">
              <h2>Scan vom {formatTimestamp(report.startedAt)}</h2>
              <p>Dauer: {report.durationSeconds}s</p>
              <div className="severity-summary">
                {SEVERITY_ORDER.map((sev) => (
                  <SeverityBadge key={sev} severity={sev} count={report.summary[sev]} />
                ))}
              </div>
            </div>
            {report.llmTriage && <LlmTriageCard triage={report.llmTriage} />}
            <div className="tool-result-list">
              {report.tools.map((tool) => (
                <ToolResultCard key={tool.tool} tool={tool} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
