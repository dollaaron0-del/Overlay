export interface BackupSummary {
  id: string; // e.g. "2026-07-29T03-00-00", same id scheme as ScanReport
  startedAt: string;
  finishedAt: string;
  durationSeconds: number;
  success: boolean;
  filesNew?: number;
  filesChanged?: number;
  filesUnmodified?: number;
  totalBytesProcessed?: number;
  dataAdded?: number;
  snapshotId?: string;
  error?: string;
}

// Message envelope for /ws/backup-progress — real progress parsed live from
// restic's own `--json` status lines, not a fabricated estimate.
export type BackupProgressMessage =
  | { type: "progress"; percentDone: number; filesDone: number; totalFiles: number }
  | { type: "done" };
