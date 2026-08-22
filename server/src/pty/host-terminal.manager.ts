import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { config } from "../config.js";
import { PtySession } from "./pty.session.js";

// A single, always-on pty onto the host itself — deliberately outside any
// project's bubblewrap sandbox (see sandbox.ts), so it can run commands that
// don't belong to one project (systemctl, journalctl, disk usage, ...) next
// to a project's own terminal. There is only ever one: unlike project
// sessions there is no id to key on, and one shared shell surviving
// reconnects (same reasoning as project sessions, see pty.manager.ts) is the
// whole point.
let session: PtySession | undefined;

/**
 * Shells that exist purely to *refuse* a login. Spawning one is not an
 * error the pty layer can see: nologin prints "This account is currently
 * not available." and exits 1, so the terminal appears to open and then
 * dies instantly.
 */
const REFUSING_SHELLS = new Set(["nologin", "false"]);

const FALLBACK_SHELLS = ["/bin/bash", "/bin/sh"];

function isUsableShell(shell: string): boolean {
  if (REFUSING_SHELLS.has(path.basename(shell))) return false;
  try {
    fs.accessSync(shell, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Picks the shell the host terminal runs.
 *
 * The subtlety is $SHELL: this process runs as a hardened *service* user
 * whose passwd entry deliberately says /usr/sbin/nologin (see
 * docs/SECURITY.md — the account must not be loginnable over ssh), and
 * systemd/pm2 export that same value as $SHELL. Taking it at face value
 * made every host-terminal connection open, print "This account is
 * currently not available." and exit 1 — the shell was refusing a login
 * that was never happening, since the pty is spawned by an
 * already-authenticated process rather than by logging in.
 *
 * So $SHELL is only a *hint* here, used when it points at something
 * actually runnable. An explicit HOST_TERMINAL_SHELL is always honoured as
 * given: if it is wrong the operator set it, and a spawn error naming their
 * value is more useful than silently running something else.
 */
export function resolveHostShell(): string {
  if (config.HOST_TERMINAL_SHELL) return config.HOST_TERMINAL_SHELL;

  const candidates = [process.env.SHELL, ...FALLBACK_SHELLS];
  for (const candidate of candidates) {
    if (candidate && isUsableShell(candidate)) return candidate;
  }
  // Nothing was runnable; let the spawn fail on the conventional shell so
  // the terminal shows a real ENOENT rather than this module guessing on.
  return FALLBACK_SHELLS[0];
}

/**
 * Home is the natural place to start, but a service user's home can be
 * missing entirely (DynamicUser=, a wiped /home) — and node-pty throws on a
 * non-existent cwd, which would take down the whole upgrade instead of just
 * starting somewhere else.
 */
function resolveHostCwd(): string {
  const preferred = config.HOST_TERMINAL_CWD || os.homedir();
  try {
    if (fs.statSync(preferred).isDirectory()) return preferred;
  } catch {
    // fall through
  }
  return "/";
}

export function getOrCreateHostSession(): PtySession {
  if (session?.isAlive) return session;

  const shell = resolveHostShell();

  // Also override the inherited $SHELL: anything the user starts in here
  // (git's editor, sudo, tmux, a script asking "what shell am I in?") would
  // otherwise re-derive the same nologin path this function just rejected.
  session = new PtySession(shell, [], resolveHostCwd(), { SHELL: shell });
  return session;
}
