import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Wraps a project's terminal command in a bubblewrap sandbox that can only
 * see that project.
 *
 * Every project terminal runs as the same unprivileged user, so without this
 * a session opened for one project could read and write every other project,
 * the Overlay installation itself (including any tokens/secrets in its .env)
 * and the shared Claude Code home. Giving each project its own config
 * directory separates the *data*, but nothing stopped
 * a shell command from simply walking to a neighbour — this is what turns
 * that separation into a boundary.
 *
 * The view is built by hiding first and re-exposing afterwards, because
 * bubblewrap applies its arguments in order and a later mount wins: an empty
 * tmpfs is laid over the projects root, the Overlay installation and /home,
 * and only then are this project's directory and its Claude config bound back
 * in. Everything else stays read-only, so the interpreters and the claude
 * binary keep working. The network is deliberately kept — the whole point of
 * the session is to talk to the API.
 */

export class SandboxUnavailableError extends Error {}

export interface SandboxTarget {
  /** The project directory, already resolved through any symlinks. */
  projectDir: string;
  /** CLAUDE_CONFIG_DIR for this project; must stay writable inside. */
  claudeHome: string;
  /** Root under which sibling projects live; hidden wholesale. */
  appsRoot: string;
  /** The Overlay installation itself, hidden so a session cannot reach its secrets. */
  serverDir: string;
  /**
   * Directory holding the real Claude Code login (pty/claude-home.ts's
   * SHARED_HOME) — read-only, so a session can use the shared login but
   * never modify or replace it. Usually lives under /home, so like a project
   * directory under /home it must be re-bound after the tmpfs that hides
   * /home. Omitted when nothing has ever logged in yet.
   */
  sharedClaudeHome?: string;
  /**
   * The shared credentials file (pty/claude-home.ts's sharedCredentialsFile())
   * inside sharedClaudeHome, re-bound read-write on top of that otherwise
   * read-only directory. Claude Code refreshes its OAuth token by writing
   * this file in place; without this narrow exception the write fails inside
   * the sandbox and every project keeps reporting an expired session no
   * matter how recently `/login` succeeded elsewhere. Only this one file
   * loses the read-only protection — everything else under sharedClaudeHome
   * (e.g. other projects' pre-migration history) stays untouchable.
   */
  sharedCredentialsFile?: string;
}

export function isSandboxAvailable(bwrapPath = "/usr/bin/bwrap"): boolean {
  return fs.existsSync(bwrapPath);
}

export function buildSandboxCommand(
  command: string,
  args: string[],
  target: SandboxTarget,
  bwrapPath = "/usr/bin/bwrap",
): { command: string; args: string[] } {
  if (!isSandboxAvailable(bwrapPath)) {
    throw new SandboxUnavailableError(
      "bubblewrap (bwrap) ist nicht installiert, die Terminal-Sandbox kann nicht starten. " +
        "Entweder 'apt install bubblewrap' ausführen oder TERMINAL_SANDBOX=false setzen.",
    );
  }

  const home = os.homedir();
  const sandboxArgs = [
    // Base: the whole system read-only, so interpreters and the claude binary
    // resolve exactly as they do outside.
    "--ro-bind", "/", "/",
    "--dev-bind", "/dev", "/dev",
    "--proc", "/proc",
    "--tmpfs", "/tmp",

    // Hide, in this order, everything a project has no business seeing.
    "--tmpfs", target.appsRoot,
    "--tmpfs", target.serverDir,
    "--tmpfs", "/home",
    // HOME must still exist and be writable: shells and tools write into it
    // even when Claude Code's own state lives in CLAUDE_CONFIG_DIR.
    "--dir", home,

    // Re-expose only this project. Listed after the tmpfs above so it wins,
    // which also covers a project that physically lives under /home.
    "--bind", target.projectDir, target.projectDir,
    "--bind", target.claudeHome, target.claudeHome,
    ...(target.sharedClaudeHome ? ["--ro-bind-try", target.sharedClaudeHome, target.sharedClaudeHome] : []),
    // Re-bound again, read-write, so this one file wins over the read-only
    // mount above (later mount at the same path wins) — see the field doc.
    ...(target.sharedCredentialsFile
      ? ["--bind-try", target.sharedCredentialsFile, target.sharedCredentialsFile]
      : []),

    // Keep the network (the session talks to the API); drop every other
    // namespace. --die-with-parent ties the sandbox to the pty, so closing a
    // session cannot leave a stray process behind.
    "--unshare-all",
    "--share-net",
    "--die-with-parent",
    "--chdir", target.projectDir,
    "--",
    command,
    ...args,
  ];

  return { command: bwrapPath, args: sandboxArgs };
}
