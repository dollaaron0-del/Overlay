import { useEffect, useState } from "react";
import type { AuditEntry, AuditEventType } from "@overlay/shared";
import { api } from "../api/client";
import { formatTimestamp } from "../format";
import { markActivityViewed } from "../os/activity-badge";

const EVENT_LABEL: Record<AuditEventType, string> = {
  login: "Login",
  login_failed: "Fehlgeschlagener Login",
  logout: "Logout",
  project_added: "Projekt hinzugefügt",
  project_removed: "Projekt entfernt",
  project_start: "Projekt gestartet",
  project_stop: "Projekt gestoppt",
  project_restart: "Projekt neu gestartet",
  project_deployed: "Projekt deployt",
  scan_triggered: "Sicherheits-Scan manuell gestartet",
  backup_triggered: "Backup manuell gestartet",
  unlock_failed: "Fehlgeschlagener Entsperr-Versuch",
  quick_capture: "Schnellnotiz gespeichert",
  idea_plan_saved: "Ideen-Plan gespeichert",
  idea_attachment_added: "Anhang zu Idee hinzugefügt",
  overlay_update_triggered: "Overlay-Update ausgelöst",
  recurring_task_triggered: "Wiederkehrender Emmy-Check ausgelöst",
  research_due_check_triggered: "Emmy-Status-Check nach Ablauf des Zeitfensters ausgelöst",
};

function eventClass(entry: AuditEntry): string {
  if (entry.type === "login_failed" || entry.type === "unlock_failed") return "activity-event-warn";
  if (entry.type === "project_deployed" && entry.detail?.includes("(failed)")) return "activity-event-warn";
  return "activity-event-normal";
}

export function ActivityLog() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    api
      .get<AuditEntry[]>("/api/audit")
      .then(setEntries)
      .catch(() => setEntries([]));
    markActivityViewed();
  }, []);

  const filtered = (entries ?? []).filter((entry) => {
    if (!filter) return true;
    const haystack = `${EVENT_LABEL[entry.type]} ${entry.actor ?? ""} ${entry.detail ?? ""}`.toLowerCase();
    return haystack.includes(filter.toLowerCase());
  });

  return (
    <div className="activity-log">
      <div className="activity-log-header">
        <h2>Aktivität</h2>
        <input
          className="activity-filter-input"
          type="text"
          placeholder="Filtern…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      {entries === null && <p className="empty-hint">Lädt…</p>}
      {entries !== null && filtered.length === 0 && (
        <p className="empty-hint">{entries.length === 0 ? "Noch keine Aktivität aufgezeichnet." : "Keine Treffer."}</p>
      )}
      {filtered.length > 0 && (
        <ul className="activity-list">
          {filtered.map((entry, i) => (
            <li key={i} className={eventClass(entry)}>
              <span className="activity-timestamp">{formatTimestamp(entry.timestamp)}</span>
              <span className="activity-event-label">{EVENT_LABEL[entry.type]}</span>
              {(entry.actor || entry.detail) && (
                <span className="activity-detail">{[entry.actor, entry.detail].filter(Boolean).join(" · ")}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
