import os from "node:os";
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

export function getOrCreateHostSession(): PtySession {
  if (session?.isAlive) return session;

  const shell = config.HOST_TERMINAL_SHELL || process.env.SHELL || "/bin/bash";
  const cwd = config.HOST_TERMINAL_CWD || os.homedir();

  session = new PtySession(shell, [], cwd);
  return session;
}
