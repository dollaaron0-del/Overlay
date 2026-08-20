import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { config } from "../config.js";

/**
 * Gives every project its own Claude Code config directory, so a project's
 * conversations, history and session state stay inside that project.
 *
 * Claude Code keeps everything under one directory (CLAUDE_CONFIG_DIR,
 * defaulting to ~/.claude) and files conversations there by working
 * directory. With every project sharing that one directory, one machine-wide
 * history accumulated: opening any project put the neighbours' transcripts
 * one `/resume` away, and a project reachable through a symlink (as
 * /opt/apps/Aktien -> /home/aaron/Aktien1 is) even split its own history
 * across two entries depending on which path it was opened by.
 *
 * The credentials file is the one thing that must stay shared — it is the
 * same account either way, and a fresh config directory is simply logged out
 * (verified: `claude auth status` reports loggedIn false in an empty one, and
 * true once this symlink exists). Linking rather than copying keeps a token
 * refresh visible to every project instead of leaving stale copies behind.
 */

// config.CLAUDE_SHARED_HOME overrides this when the real login lives under a
// different Linux user's home than the one this process runs as — see the
// config.ts comment on that flag.
const SHARED_HOME = config.CLAUDE_SHARED_HOME || path.join(os.homedir(), ".claude");
const CREDENTIALS_FILE = ".credentials.json";
const SETTINGS_FILE = "settings.json";

/** Where per-project Claude state lives, alongside the rest of the server's data. */
export function claudeHomesRoot(): string {
  return path.join(process.cwd(), "data", "claude-homes");
}

/**
 * SHARED_HOME itself, for the sandbox to re-expose read-only (see
 * pty/sandbox.ts) — otherwise the credentials symlink created below points at
 * a path bubblewrap has already hidden as part of blanking out /home.
 */
export function sharedClaudeHomeDir(): string {
  return SHARED_HOME;
}

/**
 * Path to the shared credentials file itself, for the sandbox to re-expose
 * read-write on top of the otherwise read-only sharedClaudeHomeDir() (see
 * pty/sandbox.ts) — without that, a token refresh inside the sandbox tries to
 * write through the credentials symlink and fails silently, so the session
 * keeps reporting an expired OAuth token even right after a fresh `/login`.
 */
export function sharedCredentialsFile(): string {
  return path.join(SHARED_HOME, CREDENTIALS_FILE);
}

/**
 * Creates (once) and returns the config directory for a project, ready to be
 * passed as CLAUDE_CONFIG_DIR. Safe to call on every session start.
 */
export function ensureProjectClaudeHome(projectId: string, projectDir?: string): string {
  // Project ids are validated on registration, but this path is handed to a
  // spawned process, so refuse anything that could climb out of the root
  // rather than trusting that validation from here.
  if (!projectId || projectId.includes("/") || projectId.includes("\\") || projectId === "." || projectId === "..") {
    throw new Error(`Refusing to build a Claude home for suspicious project id: ${projectId}`);
  }

  const home = path.join(claudeHomesRoot(), projectId);
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });

  linkCredentials(home);
  seedSettings(home);
  if (projectDir) adoptExistingHistory(home, projectDir);
  return home;
}

/**
 * Carries a project's existing transcripts over from the shared home the
 * first time it gets its own.
 *
 * Without this, switching a project to its own config directory reads as
 * every past conversation having been deleted — the transcripts are still on
 * disk, just under a directory Claude Code no longer looks at. Copied rather
 * than moved so the previous location keeps working if this change is ever
 * rolled back, and only when the destination is still absent, so a later
 * conversation is never overwritten by the stale copy.
 */
function adoptExistingHistory(home: string, projectDir: string): void {
  // Claude Code names a project's directory after its working directory with
  // the separators turned into dashes (/opt/apps/x -> -opt-apps-x).
  const key = projectDir.replace(/\//g, "-");
  const source = path.join(SHARED_HOME, "projects", key);
  const destination = path.join(home, "projects", key);
  if (!fs.existsSync(source) || fs.existsSync(destination)) return;

  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  fs.cpSync(source, destination, { recursive: true });
}

/**
 * Whether Claude Code already has a transcript for this project directory
 * under the given config home, i.e. whether `--continue` has something to
 * resume. Without this check, a brand-new project's first terminal session
 * gets `--continue` anyway, and current Claude Code versions exit with
 * "No conversation found to continue" instead of falling back to a fresh
 * session — killing the pty before the user can type anything.
 */
export function hasExistingConversation(home: string, projectDir: string): boolean {
  const key = projectDir.replace(/\//g, "-");
  const dir = path.join(home, "projects", key);
  try {
    return fs.readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

function linkCredentials(home: string): void {
  const target = path.join(SHARED_HOME, CREDENTIALS_FILE);
  const link = path.join(home, CREDENTIALS_FILE);

  // Nothing to link against on a machine that has never logged in; Claude
  // Code will then prompt in the terminal, which is the right outcome.
  if (!fs.existsSync(target)) return;

  const current = fs.lstatSync(link, { throwIfNoEntry: false });
  if (current?.isSymbolicLink() && fs.readlinkSync(link) === target) return;
  if (current) fs.rmSync(link, { force: true });
  fs.symlinkSync(target, link);
}

function seedSettings(home: string): void {
  // Copied, not linked: settings.json holds preferences a project may
  // legitimately diverge on (model, theme), and Claude Code rewrites this
  // file, which through a symlink would silently change every other project
  // too. Only seeded when absent, so later per-project edits survive.
  const source = path.join(SHARED_HOME, SETTINGS_FILE);
  const destination = path.join(home, SETTINGS_FILE);
  if (!fs.existsSync(source) || fs.existsSync(destination)) return;
  fs.copyFileSync(source, destination);
}
