import fs from "node:fs";
import { config } from "../config.js";
import { resolveProjectDir } from "../projects/projects.registry.js";
import type { Project } from "../projects/projects.types.js";
import { ensureProjectClaudeHome } from "./claude-home.js";
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

  // Sandboxed by default, so a session cannot reach the neighbouring projects
  // or this installation's secrets. buildSandboxCommand throws with an
  // actionable message when bubblewrap is missing rather than quietly
  // dropping the boundary — that failure is visible in the terminal, whereas
  // a silent fallback would not be.
  const { command, args } = config.TERMINAL_SANDBOX
    ? buildSandboxCommand(config.CLAUDE_COMMAND, [], {
        projectDir: cwd,
        claudeHome,
        appsRoot: realPathOrSelf(config.APPS_ROOT),
        serverDir: process.cwd(),
      })
    : { command: config.CLAUDE_COMMAND, args: [] };

  const session = new PtySession(command, args, cwd, { CLAUDE_CONFIG_DIR: claudeHome });
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
