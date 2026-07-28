export type AuditEventType =
  | "login"
  | "login_failed"
  | "logout"
  | "project_added"
  | "project_removed"
  | "project_start"
  | "project_stop"
  | "project_restart"
  | "project_deployed";

export interface AuditEntry {
  timestamp: string; // ISO
  type: AuditEventType;
  actor?: string; // e.g. username, IP
  detail?: string; // e.g. project id
}
