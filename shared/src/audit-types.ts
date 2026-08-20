export type AuditEventType =
  | "project_added"
  | "project_removed"
  | "project_start"
  | "project_stop"
  | "project_restart"
  | "project_deployed"
  | "scan_triggered"
  | "backup_triggered"
  | "quick_capture"
  | "idea_plan_saved"
  | "idea_attachment_added"
  | "overlay_update_triggered";

export interface AuditEntry {
  timestamp: string; // ISO
  type: AuditEventType;
  actor?: string; // e.g. username, IP
  detail?: string; // e.g. project id
}
