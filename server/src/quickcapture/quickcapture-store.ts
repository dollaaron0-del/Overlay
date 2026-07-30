import fs from "node:fs/promises";
import path from "node:path";

const SETTINGS_FILE = path.join(process.cwd(), "data", "quick-capture-settings.json");
const TMP_FILE = `${SETTINGS_FILE}.tmp`;

interface QuickCaptureSettings {
  targetProjectId: string | null;
  /** When true, each capture becomes its own Obsidian-style note instead of appending to inbox.md. Default false — opt-in, non-breaking. */
  obsidianMode: boolean;
}

const DEFAULT_SETTINGS: QuickCaptureSettings = { targetProjectId: null, obsidianMode: false };

let cache: QuickCaptureSettings | null = null;

async function readFromDisk(): Promise<QuickCaptureSettings> {
  try {
    const raw = await fs.readFile(SETTINGS_FILE, "utf8");
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<QuickCaptureSettings>) };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { ...DEFAULT_SETTINGS };
    throw err;
  }
}

async function ensureLoaded(): Promise<QuickCaptureSettings> {
  if (cache === null) cache = await readFromDisk();
  return cache;
}

async function persist(settings: QuickCaptureSettings): Promise<void> {
  await fs.mkdir(path.dirname(SETTINGS_FILE), { recursive: true });
  await fs.writeFile(TMP_FILE, JSON.stringify(settings, null, 2), "utf8");
  await fs.rename(TMP_FILE, SETTINGS_FILE);
  cache = settings;
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
  const settings = await ensureLoaded();
  await persist({ ...settings, targetProjectId: projectId });
}

export async function getQuickCaptureObsidianMode(): Promise<boolean> {
  const settings = await ensureLoaded();
  return settings.obsidianMode;
}

export async function setQuickCaptureObsidianMode(obsidianMode: boolean): Promise<void> {
  const settings = await ensureLoaded();
  await persist({ ...settings, obsidianMode });
}
