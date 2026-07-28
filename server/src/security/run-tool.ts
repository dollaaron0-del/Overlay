import { execFile } from "node:child_process";
import type { ExecFileException } from "node:child_process";

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export interface RunCommandOptions {
  cwd?: string;
  timeoutMs: number;
  maxBufferBytes?: number;
  /** Extra environment variables merged on top of process.env (e.g. restic's RESTIC_PASSWORD). */
  env?: Record<string, string>;
}

/**
 * Runs a command and resolves with its output regardless of exit code — a
 * non-zero exit is a normal, meaningful result for these tools (clamscan
 * exits 1 when it finds an infection, rkhunter/chkrootkit/npm audit exit
 * non-zero when they have findings), not a failure. Only rejects for actual
 * execution problems: the binary doesn't exist, isn't executable, or the
 * command times out.
 */
export function runCommand(command: string, args: string[], options: RunCommandOptions): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        cwd: options.cwd,
        timeout: options.timeoutMs,
        maxBuffer: options.maxBufferBytes ?? 50 * 1024 * 1024,
        env: options.env ? { ...process.env, ...options.env } : process.env,
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ stdout: stdout.toString(), stderr: stderr.toString(), exitCode: 0 });
          return;
        }

        const err = error as ExecFileException;
        if (typeof err.code === "string") {
          // Spawn-level failure: ENOENT (not installed), EACCES, etc.
          reject(err);
          return;
        }
        if (err.killed || err.signal) {
          reject(new Error(`Command timed out or was killed: ${command} ${args.join(" ")}`));
          return;
        }

        // A completed process with a non-zero exit code — not an error for
        // our purposes, the caller's parser decides what the output means.
        resolve({
          stdout: stdout.toString(),
          stderr: stderr.toString(),
          exitCode: typeof err.code === "number" ? err.code : null,
        });
      },
    );
  });
}
