import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import type { Project } from "./projects.types.js";

const REGISTRY_FILE = path.join(process.cwd(), "data", "projects.json");
const BACKUP_FILE = `${REGISTRY_FILE}.bak`;
const TMP_FILE = `${REGISTRY_FILE}.tmp`;

let cache: Project[] | null = null;
let writeQueue: Promise<unknown> = Promise.resolve();

async function readJson(filePath: string): Promise<Project[] | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as Project[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function readFromDisk(): Promise<Project[]> {
  try {
    const parsed = await readJson(REGISTRY_FILE);
    return parsed ?? [];
  } catch (err) {
    // A corrupted primary file (e.g. from a crash mid-write, or manual editing
    // gone wrong) shouldn't take down the whole registry — fall back to the
    // last known-good backup instead of throwing.
    console.error(`projects.json is corrupted (${(err as Error).message}); trying backup`, err);
    const backup = await readJson(BACKUP_FILE).catch(() => null);
    if (backup) {
      console.error("Recovered project registry from projects.json.bak");
      return backup;
    }
    console.error("No usable backup found either — starting with an empty project list");
    return [];
  }
}

async function writeToDisk(projects: Project[]): Promise<void> {
  writeQueue = writeQueue.then(async () => {
    await fs.mkdir(path.dirname(REGISTRY_FILE), { recursive: true });

    // Keep one rolling backup generation of the previous state before
    // overwriting, so a bad write (or a mistake right after) is recoverable.
    await fs.copyFile(REGISTRY_FILE, BACKUP_FILE).catch((err) => {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    });

    // Write-then-rename instead of writing REGISTRY_FILE directly: rename is
    // atomic on the same filesystem, so a crash mid-write can never leave
    // projects.json half-written/corrupted.
    await fs.writeFile(TMP_FILE, JSON.stringify(projects, null, 2), "utf8");
    await fs.rename(TMP_FILE, REGISTRY_FILE);
  });
  await writeQueue;
}

async function ensureLoaded(): Promise<Project[]> {
  if (cache === null) cache = await readFromDisk();
  return cache;
}

/** Resolves a project's absolute directory. Never accepts client-supplied absolute paths. */
export function resolveProjectDir(project: Pick<Project, "dirName">): string {
  return path.join(config.APPS_ROOT, project.dirName);
}

export async function listProjects(): Promise<Project[]> {
  return ensureLoaded();
}

export async function getProject(id: string): Promise<Project | undefined> {
  const projects = await ensureLoaded();
  return projects.find((p) => p.id === id);
}

export class InvalidDirNameError extends Error {}
export class InvalidSystemdUnitError extends Error {}
export class InvalidExternalUrlError extends Error {}

function assertValidDirName(dirName: string): void {
  // Must be a single path segment directly under APPS_ROOT — no traversal, no absolute paths.
  if (
    dirName.length === 0 ||
    dirName.includes("/") ||
    dirName.includes("\\") ||
    dirName === "." ||
    dirName === ".."
  ) {
    throw new InvalidDirNameError(`Invalid project directory name: ${dirName}`);
  }
}

// Mirrors the unit-name allowlist in server/src/systemd/systemd.service.ts —
// checked again here so a bad unit name is rejected at registration time
// with a clear error, not just later when someone taps Start/Stop.
const SYSTEMD_UNIT_PATTERN = /^[a-zA-Z0-9_.-]+\.service$/;

function assertValidSystemdUnit(unit: string): void {
  if (!SYSTEMD_UNIT_PATTERN.test(unit)) {
    throw new InvalidSystemdUnitError(`Invalid systemd unit name: ${unit}`);
  }
}

function assertValidExternalUrl(url: string): void {
  // https-only: this always links to a dashboard behind the same
  // Tailscale+Caddy(+Authelia) layer as Overlay itself, never a bare http
  // origin — see docs/DEPLOYMENT.md's "Extern verwaltete Projekte" section.
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new InvalidExternalUrlError(`Invalid external URL: ${url}`);
  }
  if (parsed.protocol !== "https:") {
    throw new InvalidExternalUrlError(`External URL must be https: ${url}`);
  }
}

/**
 * A systemd-kind project's dirName is an empty placeholder, not real app
 * code — Overlay creates it itself so every existing dirName-based feature
 * (security scan, files/obsidian tabs, quick-capture, idea-chat, terminal)
 * keeps working unchanged, just seeing an empty directory. Real app code for
 * these projects lives elsewhere (e.g. a different Linux user's home dir)
 * and stays untouched by Overlay.
 */
async function ensureStubDir(dirName: string): Promise<void> {
  const dir = path.join(config.APPS_ROOT, dirName);
  await fs.mkdir(dir, { recursive: true });
  const marker = path.join(dir, "README.md");
  const exists = await fs.stat(marker).catch(() => null);
  if (!exists) {
    await fs.writeFile(
      marker,
      "Dieser Ordner ist ein leerer Platzhalter, von Overlay selbst angelegt.\n" +
        "Das eigentliche Projekt läuft extern über einen systemd-Unit, nicht über PM2/APPS_ROOT " +
        "— siehe docs/DEPLOYMENT.md, Abschnitt \"Extern verwaltete Projekte\".\n",
      "utf8",
    );
  }
}

type AddProjectInput =
  | {
      kind?: "pm2";
      id: string;
      dirName: string;
      pm2Name: string;
      startScript: string;
      deployScript?: string;
    }
  | {
      kind: "systemd";
      id: string;
      dirName: string;
      systemdUnit: string;
      externalUrl: string;
    };

export async function addProject(input: AddProjectInput): Promise<Project> {
  assertValidDirName(input.dirName);

  if (input.kind === "systemd") {
    assertValidSystemdUnit(input.systemdUnit);
    assertValidExternalUrl(input.externalUrl);
    await ensureStubDir(input.dirName);
  } else {
    const dir = path.join(config.APPS_ROOT, input.dirName);
    const stat = await fs.stat(dir).catch(() => null);
    if (!stat || !stat.isDirectory()) {
      throw new Error(`Directory does not exist under APPS_ROOT: ${input.dirName}`);
    }
  }

  const projects = await ensureLoaded();
  if (projects.some((p) => p.id === input.id)) {
    throw new Error(`Project with id "${input.id}" already exists`);
  }
  const project: Project = { ...input };
  const next = [...projects, project];
  await writeToDisk(next);
  cache = next;
  return project;
}

/** Sets (or clears, with null) a project's custom home-screen icon. */
export async function updateProjectIcon(id: string, icon: string | null): Promise<Project | undefined> {
  const projects = await ensureLoaded();
  const index = projects.findIndex((p) => p.id === id);
  if (index === -1) return undefined;

  const next = [...projects];
  next[index] = { ...next[index], icon: icon ?? undefined };
  await writeToDisk(next);
  cache = next;
  return next[index];
}

/** Sets (or clears, with null) a project's custom display name. */
export async function updateProjectName(id: string, name: string | null): Promise<Project | undefined> {
  const projects = await ensureLoaded();
  const index = projects.findIndex((p) => p.id === id);
  if (index === -1) return undefined;

  const next = [...projects];
  next[index] = { ...next[index], name: name ?? undefined };
  await writeToDisk(next);
  cache = next;
  return next[index];
}

/** Subdirectories of APPS_ROOT that aren't registered as a project yet. */
export async function listAvailableDirs(): Promise<string[]> {
  const projects = await ensureLoaded();
  const registered = new Set(projects.map((p) => p.dirName));

  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(config.APPS_ROOT, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && !registered.has(entry.name))
    .map((entry) => entry.name)
    .sort();
}

export async function removeProject(id: string): Promise<boolean> {
  const projects = await ensureLoaded();
  const next = projects.filter((p) => p.id !== id);
  if (next.length === projects.length) return false;
  await writeToDisk(next);
  cache = next;
  return true;
}
