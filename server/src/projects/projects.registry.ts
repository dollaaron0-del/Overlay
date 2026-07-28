import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import type { Project } from "./projects.types.js";

const REGISTRY_FILE = path.join(process.cwd(), "data", "projects.json");

let cache: Project[] | null = null;
let writeQueue: Promise<unknown> = Promise.resolve();

async function readFromDisk(): Promise<Project[]> {
  try {
    const raw = await fs.readFile(REGISTRY_FILE, "utf8");
    return JSON.parse(raw) as Project[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

async function writeToDisk(projects: Project[]): Promise<void> {
  writeQueue = writeQueue.then(async () => {
    await fs.mkdir(path.dirname(REGISTRY_FILE), { recursive: true });
    await fs.writeFile(REGISTRY_FILE, JSON.stringify(projects, null, 2), "utf8");
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

export async function removeProject(id: string): Promise<boolean> {
  const projects = await ensureLoaded();
  const next = projects.filter((p) => p.id !== id);
  if (next.length === projects.length) return false;
  await writeToDisk(next);
  cache = next;
  return true;
}
