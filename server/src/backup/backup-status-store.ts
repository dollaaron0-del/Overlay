import fs from "node:fs/promises";
import path from "node:path";
import type { BackupSummary } from "@overlay/shared";

const BACKUPS_DIR = path.join(process.cwd(), "data", "backups");
const RETENTION_COUNT = 60; // ~2 months of daily runs; restic itself is the real backup history

const ID_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/;

export function isValidBackupId(id: string): boolean {
  return ID_PATTERN.test(id);
}

export function makeBackupId(date: Date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function summaryPath(id: string): string {
  return path.join(BACKUPS_DIR, `${id}.json`);
}

export async function saveBackupSummary(summary: BackupSummary): Promise<void> {
  if (!isValidBackupId(summary.id)) {
    throw new Error(`Refusing to save backup summary with malformed id: ${summary.id}`);
  }
  await fs.mkdir(BACKUPS_DIR, { recursive: true });
  const tmpFile = `${summaryPath(summary.id)}.tmp`;
  await fs.writeFile(tmpFile, JSON.stringify(summary, null, 2), "utf8");
  await fs.rename(tmpFile, summaryPath(summary.id));
  await pruneOld();
}

async function listIds(): Promise<string[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(BACKUPS_DIR);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  return entries
    .filter((name) => name.endsWith(".json") && !name.endsWith(".tmp"))
    .map((name) => name.slice(0, -".json".length))
    .filter(isValidBackupId)
    .sort()
    .reverse();
}

export async function getBackupSummary(id: string): Promise<BackupSummary | undefined> {
  if (!isValidBackupId(id)) return undefined;
  try {
    const raw = await fs.readFile(summaryPath(id), "utf8");
    return JSON.parse(raw) as BackupSummary;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

export async function listBackupSummaries(): Promise<BackupSummary[]> {
  const ids = await listIds();
  const summaries = await Promise.all(ids.map((id) => getBackupSummary(id)));
  return summaries.filter((s): s is BackupSummary => s !== undefined);
}

export async function getLatestBackupSummary(): Promise<BackupSummary | undefined> {
  const ids = await listIds();
  if (ids.length === 0) return undefined;
  return getBackupSummary(ids[0]);
}

async function pruneOld(): Promise<void> {
  const ids = await listIds();
  const toDelete = ids.slice(RETENTION_COUNT);
  await Promise.all(toDelete.map((id) => fs.rm(summaryPath(id), { force: true })));
}
