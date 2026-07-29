import fs from "node:fs/promises";
import path from "node:path";

const SETTINGS_FILE = path.join(process.cwd(), "data", "quick-capture-settings.json");
const TMP_FILE = `${SETTINGS_FILE}.tmp`;

interface QuickCaptureSettings {
  targetProjectId: string | null;
}

let cache: QuickCaptureSettings | null = null;

async function readFromDisk(): Promise<QuickCaptureSettings> {
  try {
    const raw = await fs.readFile(SETTINGS_FILE, "utf8");
    return JSON.parse(raw) as QuickCaptureSettings;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { targetProjectId: null };
    throw err;
  }
}

async function ensureLoaded(): Promise<QuickCaptureSettings> {
  if (cache === null) cache = await readFromDisk();
  return cache;
}

/**
 * Which project quick-captured notes get appended to. Deliberately stored
 * server-side (not localStorage) — quick capture is meant to be used from a
 * *different* device/browser (e.g. iPhone) than the main iPad session, so a
 * browser-local preference would silently not follow you there.
 */
export async function getQuickCaptureTarget(): Promise<string | null> {
  const settings = await ensureLoaded();
  return settings.targetProjectId;
}

export async function setQuickCaptureTarget(projectId: string | null): Promise<void> {
  const settings: QuickCaptureSettings = { targetProjectId: projectId };
  await fs.mkdir(path.dirname(SETTINGS_FILE), { recursive: true });
  await fs.writeFile(TMP_FILE, JSON.stringify(settings, null, 2), "utf8");
  await fs.rename(TMP_FILE, SETTINGS_FILE);
  cache = settings;
}
