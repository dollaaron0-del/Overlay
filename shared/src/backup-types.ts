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
