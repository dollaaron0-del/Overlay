export type AuditEventType =
  | "login"
  | "login_failed"
  | "logout"
  | "project_added"
  | "project_removed"
  | "project_start"
  | "project_stop"
  | "project_restart"
  | "project_deployed"
  | "scan_triggered"
  | "backup_triggered"
  | "unlock_failed";

export interface AuditEntry {
  timestamp: string; // ISO
  type: AuditEventType;
  actor?: string; // e.g. username, IP
  detail?: string; // e.g. project id
}
