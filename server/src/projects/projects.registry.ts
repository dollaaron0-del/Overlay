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

export async function addProject(input: {
  id: string;
  dirName: string;
  pm2Name: string;
  startScript: string;
  deployScript?: string;
}): Promise<Project> {
  assertValidDirName(input.dirName);
  const dir = path.join(config.APPS_ROOT, input.dirName);
  const stat = await fs.stat(dir).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    throw new Error(`Directory does not exist under APPS_ROOT: ${input.dirName}`);
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
