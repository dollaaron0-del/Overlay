import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

// Shared secret between the long-running Overlay server and the oneshot
// emmy-scheduler.cli.ts process that the systemd timer starts every 15
// minutes. Both run on the same host as the same user, so a file in data/
// is enough — no operator setup, which is the whole point of this module.
//
// Before this existed, the scheduler route reused AUTOMATION_TOKEN. That
// token is the *opt-in* credential for the external OpenClaw automation API
// (/api/automation/*), so a stock install that never touches OpenClaw leaves
// it empty — and then requireAutomationToken 404s the scheduler route, every
// tick exits 1, and Emmy's recurring research silently never fires while the
// UI keeps showing tasks as "fällig". Internal scheduling must not depend on
// an unrelated external integration being configured.
// Resolved from this module's own location, NOT process.cwd(): the server is
// started by PM2 from the repo root while the systemd unit runs the CLI with
// WorkingDirectory=<repo>/server, so a cwd-relative path would have the two
// processes create and compare two different token files — auth would 401 on
// every tick. Both src/emmy/ and dist/emmy/ sit two levels under server/, so
// three levels up is the repo root in dev and in production alike.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const SCHEDULER_TOKEN_FILE = path.join(REPO_ROOT, "data", "emmy-scheduler-token");

/**
 * Reads the internal scheduler token, creating it on first call.
 *
 * Synchronous on purpose: the server calls this while wiring routes at boot
 * and the CLI calls it before its single request, so neither benefits from
 * async, and a sync read keeps "generate exactly once" trivially race-free
 * within a process.
 *
 * `tokenFile` exists so tests can point at a tmpdir instead of writing into
 * the real repo; production callers always use the default.
 */
export function getSchedulerToken(tokenFile: string = SCHEDULER_TOKEN_FILE): string {
  const existing = readIfPresent(tokenFile);
  if (existing) return existing;

  const token = crypto.randomBytes(32).toString("hex");
  fs.mkdirSync(path.dirname(tokenFile), { recursive: true });
  try {
    // wx = fail if it already exists, so a server and a CLI tick racing on a
    // first-ever boot can't end up holding two different tokens: the loser of
    // the create reads the winner's value below. 0600 because the token is
    // equivalent to permission to run a tick — only the user both processes
    // run as should be able to read it.
    fs.writeFileSync(tokenFile, token, { encoding: "utf8", mode: 0o600, flag: "wx" });
    return token;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    // Either another process won the create race — use its token — or the
    // file exists but is empty/whitespace (a truncated write, a half-restored
    // backup). Returning that blank value would leave the scheduler unable to
    // authenticate forever, so replace it instead.
    const raced = readIfPresent(tokenFile);
    if (raced) return raced;
    fs.writeFileSync(tokenFile, token, { encoding: "utf8", mode: 0o600 });
    return token;
  }
}

function readIfPresent(tokenFile: string): string {
  try {
    return fs.readFileSync(tokenFile, "utf8").trim();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    return "";
  }
}
