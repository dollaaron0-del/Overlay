import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";

export const SESSION_COOKIE_NAME = "overlay_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SESSIONS_FILE = path.join(process.cwd(), "data", "sessions.json");

interface SessionRecord {
  id: string;
  expiresAt: number;
  /** Fingerprint of the admin password this session was created under (see passwordFingerprint). */
  pw: string;
}

/**
 * Ties every session to the admin password in force when it was created.
 * Changing ADMIN_PASSWORD_HASH is the normal reaction to a suspected
 * compromise, but on its own it only stops *new* logins — an already-stolen
 * cookie would otherwise keep working for the full 30-day TTL. Comparing this
 * fingerprint on every validation makes a password change revoke every
 * existing session immediately. Only a fingerprint is stored, never the hash
 * itself, so the sessions file stays useless to anyone who reads it.
 */
function passwordFingerprint(): string {
  return crypto.createHash("sha256").update(config.ADMIN_PASSWORD_HASH).digest("hex").slice(0, 32);
}

const sessions = new Map<string, SessionRecord>();
let writeQueue: Promise<unknown> = Promise.resolve();

function persist(): void {
  writeQueue = writeQueue
    .then(async () => {
      await fs.mkdir(path.dirname(SESSIONS_FILE), { recursive: true, mode: 0o700 });
      const records = Array.from(sessions.values());
      // Explicit 0600: these ids are live credentials — combined with
      // SESSION_SECRET they reconstruct a valid cookie — so they must not be
      // readable by other local accounts on the box. (mode only applies when
      // the file is created; deploy/harden-permissions.sh fixes existing ones.)
      await fs.writeFile(SESSIONS_FILE, JSON.stringify(records), { encoding: "utf8", mode: 0o600 });
    })
    .catch((err) => console.error("Failed to persist sessions:", err));
}

export async function loadSessions(): Promise<void> {
  try {
    const raw = await fs.readFile(SESSIONS_FILE, "utf8");
    const records: SessionRecord[] = JSON.parse(raw);
    const now = Date.now();
    const currentPw = passwordFingerprint();
    for (const record of records) {
      // Records written before sessions carried a fingerprint have no `pw` and
      // are dropped here — worst case that costs one re-login after an upgrade,
      // which is the safe direction to fail in.
      if (record.expiresAt > now && record.pw === currentPw) sessions.set(record.id, record);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error("Failed to load sessions:", err);
    }
  }
}

function sign(id: string): string {
  const hmac = crypto.createHmac("sha256", config.SESSION_SECRET).update(id).digest("hex");
  return `${id}.${hmac}`;
}

function unsign(signed: string): string | null {
  const dot = signed.lastIndexOf(".");
  if (dot === -1) return null;
  const id = signed.slice(0, dot);
  const mac = signed.slice(dot + 1);
  const expected = crypto.createHmac("sha256", config.SESSION_SECRET).update(id).digest("hex");
  const macBuf = Buffer.from(mac);
  const expectedBuf = Buffer.from(expected);
  if (macBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(macBuf, expectedBuf)) {
    return null;
  }
  return id;
}

export function createSession(): string {
  const id = crypto.randomBytes(32).toString("hex");
  sessions.set(id, { id, expiresAt: Date.now() + SESSION_TTL_MS, pw: passwordFingerprint() });
  persist();
  return sign(id);
}

export function validateSessionCookie(cookieValue: string | undefined): boolean {
  if (!cookieValue) return false;
  const id = unsign(cookieValue);
  if (!id) return false;
  const record = sessions.get(id);
  if (!record) return false;
  if (record.expiresAt < Date.now()) {
    sessions.delete(id);
    persist();
    return false;
  }
  if (record.pw !== passwordFingerprint()) {
    // The admin password changed after this session was issued — revoke it.
    sessions.delete(id);
    persist();
    return false;
  }
  return true;
}

export function destroySessionCookie(cookieValue: string | undefined): void {
  if (!cookieValue) return;
  const id = unsign(cookieValue);
  if (!id) return;
  sessions.delete(id);
  persist();
}

export const SESSION_MAX_AGE_SECONDS = SESSION_TTL_MS / 1000;

/** Test-only: lets tests await the fire-and-forget persistence write queue before cleanup. */
export function _flushPendingWrites(): Promise<unknown> {
  return writeQueue;
}
