import fs from "node:fs/promises";
import path from "node:path";
import type { CpuHealthSnapshot } from "./cpu-health.js";

const HISTORY_DIR = path.join(process.cwd(), "data", "cpu-health");
const HISTORY_FILE = path.join(HISTORY_DIR, "history.jsonl");

// ~31 days at one snapshot per 5 minutes. Keeps the file in the low-MB range
// forever instead of growing without bound.
const MAX_ENTRIES = 8928;

export async function appendCpuHealthSnapshot(snapshot: CpuHealthSnapshot): Promise<void> {
  await fs.mkdir(HISTORY_DIR, { recursive: true });
  await fs.appendFile(HISTORY_FILE, `${JSON.stringify(snapshot)}\n`, "utf8");
  await pruneIfNeeded();
}

async function pruneIfNeeded(): Promise<void> {
  let raw: string;
  try {
    raw = await fs.readFile(HISTORY_FILE, "utf8");
  } catch {
    return;
  }
  const lines = raw.split("\n").filter(Boolean);
  if (lines.length <= MAX_ENTRIES) return;
  const trimmed = lines.slice(lines.length - MAX_ENTRIES);
  const tmpFile = `${HISTORY_FILE}.tmp`;
  await fs.writeFile(tmpFile, `${trimmed.join("\n")}\n`, "utf8");
  await fs.rename(tmpFile, HISTORY_FILE);
}

export async function readCpuHealthHistory(sinceMs: number): Promise<CpuHealthSnapshot[]> {
  let raw: string;
  try {
    raw = await fs.readFile(HISTORY_FILE, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const cutoff = Date.now() - sinceMs;
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as CpuHealthSnapshot)
    .filter((snapshot) => new Date(snapshot.timestamp).getTime() >= cutoff);
}
