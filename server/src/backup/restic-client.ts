import { runCommand } from "../security/run-tool.js";

export interface ResticEnv {
  repository: string;
  password: string;
}

export interface BackupResult {
  filesNew: number;
  filesChanged: number;
  filesUnmodified: number;
  totalBytesProcessed: number;
  dataAdded: number;
  snapshotId: string | undefined;
}

function resticEnv(env: ResticEnv): Record<string, string> {
  return { RESTIC_REPOSITORY: env.repository, RESTIC_PASSWORD: env.password };
}

/** True if `restic snapshots` succeeds against the repo (i.e. it's already initialized). */
export async function repositoryExists(env: ResticEnv, timeoutMs: number): Promise<boolean> {
  const result = await runCommand("restic", ["snapshots", "--json"], {
    timeoutMs,
    env: resticEnv(env),
  });
  return result.exitCode === 0;
}

export async function initRepository(env: ResticEnv, timeoutMs: number): Promise<void> {
  const result = await runCommand("restic", ["init"], { timeoutMs, env: resticEnv(env) });
  if (result.exitCode !== 0) {
    throw new Error(`restic init failed: ${result.stderr.slice(0, 500)}`);
  }
}

/**
 * Parses restic's `--json` backup output: JSON Lines with periodic
 * "status" messages and one final "summary" message. Verified against a
 * real restic 0.16.4 run, not guessed from docs.
 */
export function parseBackupSummary(jsonLinesOutput: string): BackupResult | null {
  for (const line of jsonLinesOutput.trim().split("\n").reverse()) {
    if (!line.trim()) continue;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (parsed.message_type === "summary") {
      return {
        filesNew: Number(parsed.files_new ?? 0),
        filesChanged: Number(parsed.files_changed ?? 0),
        filesUnmodified: Number(parsed.files_unmodified ?? 0),
        totalBytesProcessed: Number(parsed.total_bytes_processed ?? 0),
        dataAdded: Number(parsed.data_added ?? 0),
        snapshotId: typeof parsed.snapshot_id === "string" ? parsed.snapshot_id : undefined,
      };
    }
  }
  return null;
}

export async function runBackup(paths: string[], env: ResticEnv, timeoutMs: number): Promise<BackupResult> {
  const result = await runCommand("restic", ["backup", ...paths, "--json"], {
    timeoutMs,
    env: resticEnv(env),
  });
  const summary = parseBackupSummary(result.stdout);
  if (!summary) {
    throw new Error(`restic backup produced no summary line (exit ${result.exitCode}): ${result.stderr.slice(0, 500)}`);
  }
  return summary;
}

export interface RetentionPolicy {
  keepDaily: number;
  keepWeekly: number;
  keepMonthly: number;
}

export async function forgetAndPrune(env: ResticEnv, retention: RetentionPolicy, timeoutMs: number): Promise<void> {
  const result = await runCommand(
    "restic",
    [
      "forget",
      "--keep-daily",
      String(retention.keepDaily),
      "--keep-weekly",
      String(retention.keepWeekly),
      "--keep-monthly",
      String(retention.keepMonthly),
      "--prune",
    ],
    { timeoutMs, env: resticEnv(env) },
  );
  if (result.exitCode !== 0) {
    throw new Error(`restic forget/prune failed: ${result.stderr.slice(0, 500)}`);
  }
}
