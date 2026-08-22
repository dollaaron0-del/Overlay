import fs from "node:fs";
import { config } from "../config.js";
import { resolveProjectDir } from "../projects/projects.registry.js";
import type { Project } from "../projects/projects.types.js";
import {
  ensureProjectClaudeHome,
  hasExistingConversation,
  sharedClaudeHomeDir,
  syncClaudeCredentials,
} from "./claude-home.js";
import { ensureGitCredentialHelper } from "./git-credentials.js";
import { buildSandboxCommand } from "./sandbox.js";
import { PtySession } from "./pty.session.js";

const sessions = new Map<string, PtySession>();

/**
 * Whether any project terminal currently has a live pty. Exposed so the
 * root-run auto-update check (deploy/check-and-update.sh) can defer
 * restarting this process while someone is mid-session instead of always
 * killing every open terminal — see the comment above about `--continue`
 * for why that used to be the only mitigation.
 */
export function hasActiveSessions(): boolean {
  for (const session of sessions.values()) {
    if (session.isAlive) return true;
  }
  return false;
}

export function getOrCreateSession(project: Project): PtySession {
  const existing = sessions.get(project.id);
  if (existing && existing.isAlive) return existing;

  // Resolve symlinks: Claude Code files conversations by working directory,
  // and a project reached through a link (/opt/apps/Aktien ->
  // /home/aaron/Aktien1) would otherwise land under a different key
  // depending on the path, splitting one project's history in two.
  //
  // A project that pins its real code elsewhere via codeDir (its APPS_ROOT
  // dir is only an empty placeholder — see Project.codeDir) runs its terminal
  // *in* that code: the shell starts there, the directory is bound into the
  // sandbox, and the conversation/--continue key lines up with where edits
  // actually happen instead of the empty stub.
  const cwd = realPathOrSelf(project.codeDir ?? resolveProjectDir(project));
  const claudeHome = ensureProjectClaudeHome(project.id, cwd);
  ensureGitCredentialHelper(cwd);

  // A fresh PtySession here always means the previous claude process is
  // gone — either this project's terminal was never opened, or (the common
  // case now that overlay-check-update.timer restarts the server on its
  // own) an update just killed every running pty. --continue resumes the
  // most recent conversation for this cwd so reopening a project after a
  // restart lands back in the existing chat instead of a blank one. Only
  // added when a transcript for this cwd actually exists: Claude Code does
  // NOT fall back to a fresh session when there is nothing to resume — it
  // prints "No conversation found to continue" and exits immediately,
  // which would kill a brand-new project's very first terminal before the
  // user can type anything. Only added for the real CLI — CLAUDE_COMMAND is
  // overridden to e.g. "bash" for local pty-plumbing tests, which doesn't
  // understand this flag.
  const claudeArgs =
    config.CLAUDE_COMMAND === "claude" && hasExistingConversation(claudeHome, cwd) ? ["--continue"] : [];

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
      })
    : { command: config.CLAUDE_COMMAND, args: claudeArgs };

  const session = new PtySession(command, args, cwd, {
    CLAUDE_CONFIG_DIR: claudeHome,
    ...(config.GIT_SANDBOX_PUSH_TOKEN ? { GH_TOKEN: config.GIT_SANDBOX_PUSH_TOKEN } : {}),
  });
  sessions.set(project.id, session);
  session.onExit(() => {
    if (sessions.get(project.id) === session) sessions.delete(project.id);
    // A session that refreshed its OAuth token wrote the new one into its own
    // config dir; carry it back to the shared login so the next project to
    // open does not start from an older token (refresh tokens rotate, so an
    // older one no longer works). Never allowed to throw: this runs on the
    // way out of a pty, where nothing is left to handle it.
    try {
      syncClaudeCredentials(claudeHome);
    } catch (err) {
      console.warn(`[claude-home] Could not carry ${project.id}'s refreshed login back to the shared one:`, err);
    }
  });
  return session;
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
