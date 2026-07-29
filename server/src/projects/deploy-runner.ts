import { spawn } from "node:child_process";

export interface DeployLine {
  stream: "out" | "err";
  text: string;
}

export interface DeployResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

/**
 * Runs a deploy script via `sh -c`, calling `onLine` live as each line of
 * stdout/stderr arrives — not just once the whole thing finishes. An
 * arbitrary user-supplied deploy script has no known internal "steps" to
 * report a percentage against, so live output is the honest equivalent of
 * progress here (same principle as a live log tail), rather than a
 * fabricated progress bar.
 */
export function runDeployScript(
  script: string,
  cwd: string,
  timeoutMs: number,
  onLine?: (line: DeployLine) => void,
): Promise<DeployResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("sh", ["-c", script], { cwd });

    let stdout = "";
    let stderr = "";
    let outBuffer = "";
    let errBuffer = "";
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    const handleChunk = (stream: "out" | "err", chunk: Buffer) => {
      const text = chunk.toString("utf8");
      if (stream === "out") stdout += text;
      else stderr += text;

      if (!onLine) return;
      let buffer = (stream === "out" ? outBuffer : errBuffer) + text;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? ""; // keep a not-yet-newline-terminated tail for the next chunk
      if (stream === "out") outBuffer = buffer;
      else errBuffer = buffer;
      for (const line of lines) onLine({ stream, text: line });
    };

    child.stdout.on("data", (chunk: Buffer) => handleChunk("out", chunk));
    child.stderr.on("data", (chunk: Buffer) => handleChunk("err", chunk));

    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      if (timedOut) {
        reject(new Error(`deploy script timed out after ${timeoutMs}ms`));
        return;
      }
      // Flush any trailing output that never ended in a newline, same as a
      // real terminal would still show it.
      if (onLine) {
        if (outBuffer) onLine({ stream: "out", text: outBuffer });
        if (errBuffer) onLine({ stream: "err", text: errBuffer });
      }
      resolve({ stdout, stderr, exitCode: code });
    });
  });
}
