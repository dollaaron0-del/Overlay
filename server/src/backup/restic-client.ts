import { spawn } from "node:child_process";
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

export interface BackupProgress {
  percentDone: number;
  filesDone: number;
  totalFiles: number;
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

/** Parses one line of restic's `--json` output; returns null for anything that isn't a "status" progress line. */
export function parseStatusLine(line: string): BackupProgress | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (parsed.message_type !== "status") return null;
  return {
    percentDone: Number(parsed.percent_done ?? 0),
    filesDone: Number(parsed.files_done ?? 0),
    totalFiles: Number(parsed.total_files ?? 0),
  };
}

/**
 * Runs `restic backup --json` via spawn (not the execFile-based runCommand)
 * so `onProgress` can be called live from restic's own periodic "status"
 * lines as they arrive, instead of only seeing the final result once the
 * whole backup has finished. The final result is still parsed from the
 * complete accumulated output via parseBackupSummary, same as before.
 */
export function runBackup(
  paths: string[],
  env: ResticEnv,
  timeoutMs: number,
  onProgress?: (progress: BackupProgress) => void,
): Promise<BackupResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("restic", ["backup", ...paths, "--json"], {
      env: { ...process.env, ...resticEnv(env) },
    });

    let stdout = "";
    let stderr = "";
    let lineBuffer = "";
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stdout += text;
      lineBuffer += text;
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() ?? ""; // keep a not-yet-newline-terminated tail for the next chunk

      if (!onProgress) return;
      for (const line of lines) {
        if (!line.trim()) continue;
        // parseStatusLine already swallows partial lines straddling two
        // chunks / non-JSON lines, same tolerance parseBackupSummary has.
        const progress = parseStatusLine(line);
        if (progress) onProgress(progress);
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      if (timedOut) {
        reject(new Error(`restic backup timed out after ${timeoutMs}ms`));
        return;
      }
      const summary = parseBackupSummary(stdout);
      if (!summary) {
        reject(new Error(`restic backup produced no summary line (exit ${code}): ${stderr.slice(0, 500)}`));
        return;
      }
      resolve(summary);
    });
  });
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
