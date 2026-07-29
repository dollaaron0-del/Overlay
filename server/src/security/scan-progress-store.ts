import fs from "node:fs/promises";
import path from "node:path";
import type { ScanProgress } from "@overlay/shared";

const PROGRESS_FILE = path.join(process.cwd(), "data", "scan-progress.json");
const TMP_FILE = `${PROGRESS_FILE}.tmp`;

/**
 * Written by the separate root-privileged scan process (see cli.ts) as each
 * stage starts — explicit mode 0o644 so the unprivileged web server can
 * read it immediately, unlike the finished report files which only become
 * readable by that user after the end-of-scan chown step. A stuck-root
 * progress file left over from a crashed run is harmless: it just gets
 * overwritten (or cleared) by the next real run.
 */
export async function writeScanProgress(progress: ScanProgress): Promise<void> {
  await fs.mkdir(path.dirname(PROGRESS_FILE), { recursive: true });
  await fs.writeFile(TMP_FILE, JSON.stringify(progress), { encoding: "utf8", mode: 0o644 });
  await fs.rename(TMP_FILE, PROGRESS_FILE);
}

/** Called once the scan finishes (success or failure) — an absent file means "nothing running". */
export async function clearScanProgress(): Promise<void> {
  await fs.rm(PROGRESS_FILE, { force: true });
}

export async function getScanProgress(): Promise<ScanProgress | null> {
  try {
    const raw = await fs.readFile(PROGRESS_FILE, "utf8");
    return JSON.parse(raw) as ScanProgress;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}
