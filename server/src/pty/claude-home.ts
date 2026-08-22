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
 * true once the credentials are there).
 *
 * That sharing used to be a symlink from each project home into SHARED_HOME,
 * and that symlink was why the login kept being lost. Claude Code does not
 * write .credentials.json in place: it writes a temporary file next to it and
 * rename()s that over the target. A rename *replaces* a symlink instead of
 * following it, so the first token refresh inside a project silently turned
 * that project's link into a private regular file and SHARED_HOME never saw a
 * new token again. The next session start then found "not a symlink", deleted
 * the file holding the only valid token and re-linked to the long-stale
 * shared one — and because refresh tokens rotate, replaying that stale token
 * failed and left the shared file with empty strings, after which every
 * terminal opened logged out. Observed exactly that here: the shared file sat
 * at accessToken "" / expiresAt 0 for ten days while a project home held a
 * perfectly valid token that every session start threw away.
 *
 * So the credentials are copied in both directions instead, and the freshest
 * usable one wins. Both ends stay ordinary files — which is what Claude
 * Code's rename expects — and a valid login can never be overwritten by an
 * older or emptied one.
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
 * pty/sandbox.ts) — it usually lives under /home, which bubblewrap blanks out
 * wholesale.
 */
export function sharedClaudeHomeDir(): string {
  return SHARED_HOME;
}

/**
 * Path to the shared credentials file, i.e. where the machine's one Claude
 * Code login lives. Only ever read and written by this process, never by a
 * sandboxed session: the session works exclusively on its own project copy,
 * and syncClaudeCredentials() carries a refreshed token back here afterwards.
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

  syncClaudeCredentials(home);
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

interface Credential {
  raw: string;
  /** False for a file that still has the right shape but no token left in it. */
  usable: boolean;
  expiresAt: number;
  mtimeMs: number;
}

/**
 * Reconciles a project's credentials with the shared login, in both
 * directions, keeping whichever is freshest — see the module comment for why
 * this is a copy and not a link.
 *
 * Called on session start (so a project picks up a login refreshed elsewhere)
 * and again on session exit (so a token this session refreshed reaches the
 * shared file, and from there every other project). Exported because that
 * second call site lives in pty.manager.ts.
 */
export function syncClaudeCredentials(home: string): void {
  const sharedFile = path.join(SHARED_HOME, CREDENTIALS_FILE);
  const projectFile = path.join(home, CREDENTIALS_FILE);

  const shared = readCredential(sharedFile);
  const project = readCredential(projectFile);
  const winner = fresher(project, shared);
  // Nothing has ever logged in anywhere. Claude Code then prompts in the
  // terminal, which is the right outcome.
  if (!winner) return;

  // A leftover symlink from the previous scheme has to become a real file
  // even when the content already matches, otherwise the next refresh inside
  // this project renames over the link again and the shared login goes stale
  // exactly as before.
  const wasLink = fs.lstatSync(projectFile, { throwIfNoEntry: false })?.isSymbolicLink() === true;
  if (wasLink || project?.raw !== winner.raw) writeAtomically(projectFile, winner.raw);

  // Only write back into a shared home that already exists — creating one
  // here would scatter a login into a directory nobody configured.
  if (shared?.raw !== winner.raw && fs.existsSync(SHARED_HOME)) writeAtomically(sharedFile, winner.raw);
}

function readCredential(file: string): Credential | undefined {
  let raw: string;
  let mtimeMs: number;
  try {
    raw = fs.readFileSync(file, "utf8");
    mtimeMs = fs.statSync(file).mtimeMs;
  } catch {
    return undefined;
  }
  if (!raw.trim()) return undefined;

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const oauth = (parsed.claudeAiOauth ?? parsed) as Record<string, unknown>;
    // A failed refresh leaves the file intact but blanks the tokens (this is
    // the state the shared file was actually found in). Such a file is a
    // logged-out marker and must never win over a real login.
    const refreshToken = oauth.refreshToken;
    const usable = typeof refreshToken === "string" ? refreshToken.length > 0 : true;
    return { raw, mtimeMs, usable, expiresAt: Number(oauth.expiresAt) || 0 };
  } catch {
    // Some other shape (an API-key file, a future format). Keep it rather
    // than discarding a login we simply do not recognise, and let mtime
    // decide.
    return { raw, mtimeMs, usable: true, expiresAt: 0 };
  }
}

/** The credential that should win, or undefined when there is none at all. */
function fresher(a?: Credential, b?: Credential): Credential | undefined {
  if (!a) return b;
  if (!b) return a;
  if (a.usable !== b.usable) return a.usable ? a : b;
  if (a.expiresAt !== b.expiresAt) return a.expiresAt > b.expiresAt ? a : b;
  return a.mtimeMs >= b.mtimeMs ? a : b;
}

/**
 * Writes via a temporary file in the same directory plus a rename, so a
 * reader (or a `claude` starting at that moment) never sees a half-written
 * login. Same directory because a rename cannot cross filesystems; 0600
 * because this is a live credential.
 */
function writeAtomically(file: string, content: string): void {
  const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
  fs.writeFileSync(tmp, content, { mode: 0o600 });
  try {
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
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
