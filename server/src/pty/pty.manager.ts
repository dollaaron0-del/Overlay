import fs from "node:fs";
import { config } from "../config.js";
import { resolveProjectDir } from "../projects/projects.registry.js";
import type { Project } from "../projects/projects.types.js";
import { ensureProjectClaudeHome, sharedClaudeHomeDir, sharedCredentialsFile } from "./claude-home.js";
import { ensureGitCredentialHelper } from "./git-credentials.js";
import { buildSandboxCommand } from "./sandbox.js";
import { PtySession } from "./pty.session.js";

const sessions = new Map<string, PtySession>();

export function getOrCreateSession(project: Project): PtySession {
  const existing = sessions.get(project.id);
  if (existing && existing.isAlive) return existing;

  // Resolve symlinks: Claude Code files conversations by working directory,
  // and a project reached through a link (/opt/apps/Aktien ->
  // /home/aaron/Aktien1) would otherwise land under a different key
  // depending on the path, splitting one project's history in two.
  const cwd = realPathOrSelf(resolveProjectDir(project));
  const claudeHome = ensureProjectClaudeHome(project.id, cwd);
  ensureGitCredentialHelper(cwd);

  // A fresh PtySession here always means the previous claude process is
  // gone — either this project's terminal was never opened, or (the common
  // case now that overlay-check-update.timer restarts the server on its
  // own) an update just killed every running pty. --continue resumes the
  // most recent conversation for this cwd so reopening a project after a
  // restart lands back in the existing chat instead of a blank one; with no
  // prior conversation it just starts fresh, same as today. Only added for
  // the real CLI — CLAUDE_COMMAND is overridden to e.g. "bash" for local
  // pty-plumbing tests, which doesn't understand this flag.
  const claudeArgs = config.CLAUDE_COMMAND === "claude" ? ["--continue"] : [];

  // Sandboxed by default, so a session cannot reach the neighbouring projects
  // or this installation's secrets. buildSandboxCommand throws with an
  // actionable message when bubblewrap is missing rather than quietly
  // dropping the boundary — that failure is visible in the terminal, whereas
  // a silent fallback would not be.
  const { command, args } = config.TERMINAL_SANDBOX
    ? buildSandboxCommand(config.CLAUDE_COMMAND, claudeArgs, {
        projectDir: cwd,
        claudeHome,
        appsRoot: realPathOrSelf(config.APPS_ROOT),
        serverDir: process.cwd(),
        sharedClaudeHome: sharedClaudeHomeDir(),
        sharedCredentialsFile: sharedCredentialsFile(),
      })
    : { command: config.CLAUDE_COMMAND, args: claudeArgs };

  const session = new PtySession(command, args, cwd, {
    CLAUDE_CONFIG_DIR: claudeHome,
    ...(config.GIT_SANDBOX_PUSH_TOKEN ? { GH_TOKEN: config.GIT_SANDBOX_PUSH_TOKEN } : {}),
  });
  sessions.set(project.id, session);
  session.onExit(() => {
    if (sessions.get(project.id) === session) sessions.delete(project.id);
  });
  return session;
}

export function stopSession(projectId: string): boolean {
  const session = sessions.get(projectId);
  if (!session) return false;
  session.kill();
  sessions.delete(projectId);
  return true;
}

export function getSession(projectId: string): PtySession | undefined {
  return sessions.get(projectId);
}

/**
 * A project directory that has gone missing should surface as the spawn
 * failing on a real path, not as this helper throwing first with a less
 * obvious message.
 */
function realPathOrSelf(dir: string): string {
  try {
    return fs.realpathSync(dir);
  } catch {
    return dir;
  }
}
