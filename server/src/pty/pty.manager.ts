import { config } from "../config.js";
import { resolveProjectDir } from "../projects/projects.registry.js";
import type { Project } from "../projects/projects.types.js";
import { PtySession } from "./pty.session.js";

const sessions = new Map<string, PtySession>();

export function getOrCreateSession(project: Project): PtySession {
  const existing = sessions.get(project.id);
  if (existing && existing.isAlive) return existing;

  const cwd = resolveProjectDir(project);
  const session = new PtySession(config.CLAUDE_COMMAND, [], cwd);
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
