import fs from "node:fs/promises";
import path from "node:path";
import type { AuditEntry, AuditEventType } from "@overlay/shared";

const AUDIT_LOG_PATH = path.join(process.cwd(), "data", "audit.jsonl");
const MAX_ENTRIES = 2000; // ample history for a personal dashboard without unbounded growth

// Serializes appendAuditEntry's read-modify-write cycle: without this, two
// concurrent calls (e.g. two project actions fired back-to-back) both read
// the same existing entries and both rewrite the file, and whichever rename
// lands second silently discards the other's entry. Kept always-resolving
// (see the .then(ok, ok) below) so one failed write can't wedge every
// subsequent append behind a permanently-rejected chain.
let writeQueue: Promise<unknown> = Promise.resolve();

/**
 * Appends one entry and, in the same pass, re-reads + rewrites the file to
 * enforce MAX_ENTRIES. A personal homelab's audit volume (logins,
 * project/process actions) is tiny — reading the whole file back on every
 * append is simpler than tracking line offsets and cheap enough at this
 * scale, same trade-off report-store.ts and backup-status-store.ts make.
 */
export async function appendAuditEntry(entry: { type: AuditEventType; actor?: string; detail?: string }): Promise<void> {
  const full: AuditEntry = { timestamp: new Date().toISOString(), ...entry };
  const run = writeQueue.then(async () => {
    const existing = await listAuditEntriesOldestFirst();
    existing.push(full);
    const trimmed = existing.slice(-MAX_ENTRIES);

    await fs.mkdir(path.dirname(AUDIT_LOG_PATH), { recursive: true });
    const tmpFile = `${AUDIT_LOG_PATH}.tmp`;
    await fs.writeFile(tmpFile, trimmed.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
    await fs.rename(tmpFile, AUDIT_LOG_PATH);
  });
  writeQueue = run.then(
    () => undefined,
    () => undefined,
  );
  await run;
}

async function listAuditEntriesOldestFirst(): Promise<AuditEntry[]> {
  let raw: string;
  try {
    raw = await fs.readFile(AUDIT_LOG_PATH, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const entries: AuditEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as AuditEntry);
    } catch {
      // Skip a malformed line (e.g. truncated by a crash mid-write) rather
      // than losing the rest of the log to a single bad entry.
    }
  }
  return entries;
}

export async function listAuditEntries(): Promise<AuditEntry[]> {
  const entries = await listAuditEntriesOldestFirst();
  return entries.reverse();
}
