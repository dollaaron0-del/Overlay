import crypto from "node:crypto";
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

async function ensureLoaded(): Promise<Project[]> {
  if (cache === null) cache = await readFromDisk();
  return cache;
}

/**
 * Runs a read-modify-write against the registry, fully serialized against
 * every other mutator through `writeQueue` — `fn` only sees the latest
 * committed state, computed and persisted atomically before the next queued
 * mutation can start. This closes a lost-update race that a plain "read
 * cache, await a write, then reassign cache" sequence has: two concurrent
 * mutations (e.g. two rapid PATCH calls) would otherwise both compute `next`
 * from the same pre-write snapshot, and whichever write lands second would
 * silently discard the first's change.
 *
 * `fn` returns the unchanged `current` array (by reference) to signal a
 * no-op (e.g. "id not found") — skips the disk write entirely in that case.
 */
async function mutateProjects<T>(fn: (current: Project[]) => { next: Project[]; result: T }): Promise<T> {
  const run = writeQueue.then(async () => {
    const current = cache ?? (await readFromDisk());
    const { next, result } = fn(current);
    if (next !== current) {
      await fs.mkdir(path.dirname(REGISTRY_FILE), { recursive: true });

      // Keep one rolling backup generation of the previous state before
      // overwriting, so a bad write (or a mistake right after) is recoverable.
      await fs.copyFile(REGISTRY_FILE, BACKUP_FILE).catch((err) => {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      });

      // Write-then-rename instead of writing REGISTRY_FILE directly: rename is
      // atomic on the same filesystem, so a crash mid-write can never leave
      // projects.json half-written/corrupted.
      await fs.writeFile(TMP_FILE, JSON.stringify(next, null, 2), "utf8");
      await fs.rename(TMP_FILE, REGISTRY_FILE);
      cache = next;
    }
    return result;
  });
  // Keep the queue itself always-resolving so one failed mutation (e.g. a
  // disk error) doesn't permanently wedge every subsequent mutation behind a
  // rejected promise — `run` still carries the real outcome to this call's
  // caller via the `return run` below.
  writeQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Resolves a project's absolute directory. Never accepts client-supplied absolute paths. */
export function resolveProjectDir(project: Pick<Project, "dirName">): string {
  return path.join(config.APPS_ROOT, project.dirName);
}

// Undefined homeSection = automatic: external (link-out) projects default to
// the Dashboards section, everything else defaults to Projekt-Terminals —
// the user can flip either way via PATCH /:id.
//
// A Dashboard tile always links straight to a project's externalUrl (see
// HomeScreen.tsx), and only kind "systemd"/"pm2-root" projects have one.
// PATCH /:id already refuses to set "dashboard" on any other kind (see
// projects.routes.ts), but this also guards a stale/hand-edited
// projects.json with an override predating that check — otherwise it'd
// resurface as an unreachable Dashboard tile with nowhere to link.
export function resolveHomeSection(project: Pick<Project, "kind" | "homeSection">): "dashboard" | "terminal" {
  const isExternal = project.kind === "systemd" || project.kind === "pm2-root";
  if (project.homeSection === "dashboard") return isExternal ? "dashboard" : "terminal";
  if (project.homeSection) return project.homeSection;
  return isExternal ? "dashboard" : "terminal";
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
export class InvalidPm2RootNameError extends Error {}
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

// Mirrors the name allowlist in server/src/pm2root/pm2root.service.ts — see
// assertValidSystemdUnit above for why this is checked again here.
const PM2_ROOT_NAME_PATTERN = /^[a-zA-Z0-9_.-]+$/;

function assertValidPm2RootName(name: string): void {
  if (!PM2_ROOT_NAME_PATTERN.test(name)) {
    throw new InvalidPm2RootNameError(`Invalid pm2-root process name: ${name}`);
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
 * A systemd- or pm2-root-kind project's dirName is an empty placeholder, not
 * real app code — Overlay creates it itself so every existing dirName-based
 * feature (security scan, files/obsidian tabs, idea-chat, terminal) keeps
 * working unchanged, just seeing an empty directory. Real app
 * code for these projects lives elsewhere (e.g. a different Linux user's home
 * dir) and stays untouched by Overlay.
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
      // Optional even for a normal PM2 project: lets a project that Overlay
      // itself runs (terminal, logs, start/stop/restart) *also* show a
      // second, synthetic Dashboard-section tile that links straight to its
      // own UI — e.g. a bot with both a web dashboard and a codebase you
      // want a terminal in. See HomeScreen.tsx's dashboardLinkItems.
      externalUrl?: string;
    }
  | {
      kind: "systemd";
      id: string;
      dirName: string;
      systemdUnit: string;
      externalUrl: string;
    }
  | {
      kind: "pm2-root";
      id: string;
      dirName: string;
      pm2RootName: string;
      externalUrl: string;
    };

export async function addProject(input: AddProjectInput): Promise<Project> {
  assertValidDirName(input.dirName);

  if (input.kind === "systemd") {
    assertValidSystemdUnit(input.systemdUnit);
    assertValidExternalUrl(input.externalUrl);
    await ensureStubDir(input.dirName);
  } else if (input.kind === "pm2-root") {
    assertValidPm2RootName(input.pm2RootName);
    assertValidExternalUrl(input.externalUrl);
    await ensureStubDir(input.dirName);
  } else {
    const dir = path.join(config.APPS_ROOT, input.dirName);
    const stat = await fs.stat(dir).catch(() => null);
    if (!stat || !stat.isDirectory()) {
      throw new Error(`Directory does not exist under APPS_ROOT: ${input.dirName}`);
    }
    if (input.externalUrl) assertValidExternalUrl(input.externalUrl);
  }

  const project: Project = { ...input };
  return mutateProjects((current) => {
    if (current.some((p) => p.id === input.id)) {
      throw new Error(`Project with id "${input.id}" already exists`);
    }
    return { next: [...current, project], result: project };
  });
}

/** Sets (or clears, with null) a project's custom home-screen icon. */
export async function updateProjectIcon(id: string, icon: string | null): Promise<Project | undefined> {
  return mutateProjects((current) => {
    const index = current.findIndex((p) => p.id === id);
    if (index === -1) return { next: current, result: undefined };
    const next = [...current];
    next[index] = { ...next[index], icon: icon ?? undefined };
    return { next, result: next[index] };
  });
}

/**
 * Sets (or clears, with null) a project's dashboard link. For a "systemd"/
 * "pm2-root" project this is its only UI, already required at creation. For
 * a normal PM2 project it's optional and additive — set it to grow a second
 * home-screen Dashboard-section tile alongside the existing Terminal one
 * (see HomeScreen.tsx's dashboardLinkItems), without turning the project
 * itself into a link-only tile.
 */
export async function updateProjectExternalUrl(id: string, url: string | null): Promise<Project | undefined> {
  if (url) assertValidExternalUrl(url);
  return mutateProjects((current) => {
    const index = current.findIndex((p) => p.id === id);
    if (index === -1) return { next: current, result: undefined };
    const next = [...current];
    next[index] = { ...next[index], externalUrl: url ?? undefined };
    return { next, result: next[index] };
  });
}

/** Sets (or clears, with null) a project's custom display name. */
export async function updateProjectName(id: string, name: string | null): Promise<Project | undefined> {
  return mutateProjects((current) => {
    const index = current.findIndex((p) => p.id === id);
    if (index === -1) return { next: current, result: undefined };
    const next = [...current];
    next[index] = { ...next[index], name: name ?? undefined };
    return { next, result: next[index] };
  });
}

/** Sets (or clears, with null, back to automatic) a project's home-screen section override. */
export async function updateProjectHomeSection(
  id: string,
  homeSection: "dashboard" | "terminal" | null,
): Promise<Project | undefined> {
  return mutateProjects((current) => {
    const index = current.findIndex((p) => p.id === id);
    if (index === -1) return { next: current, result: undefined };
    const next = [...current];
    next[index] = { ...next[index], homeSection: homeSection ?? undefined };
    return { next, result: next[index] };
  });
}

/**
 * Enables/disables auto-deploy: when true, git-deploy-watcher.ts runs this
 * project's deploy script (and restarts it on success) automatically
 * whenever a new commit appears in its directory, instead of requiring a
 * manual Deploy click. Callers must ensure deployScript is set first (see
 * the guard in projects.routes.ts's PATCH /:id) — this setter itself doesn't
 * re-check, same division of responsibility as updateProjectHomeSection.
 */
export async function updateProjectAutoDeploy(id: string, enabled: boolean): Promise<Project | undefined> {
  return mutateProjects((current) => {
    const index = current.findIndex((p) => p.id === id);
    if (index === -1) return { next: current, result: undefined };
    const next = [...current];
    next[index] = { ...next[index], autoDeployOnCommit: enabled || undefined };
    return { next, result: next[index] };
  });
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

function slugifyProjectName(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip accents (e.g. "e-acute" -> "e") after NFKD
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "projekt";
}

async function uniqueDirName(base: string): Promise<string> {
  const projects = await ensureLoaded();
  const registered = new Set(projects.map((p) => p.dirName));
  const onDisk = new Set(
    await fs
      .readdir(config.APPS_ROOT)
      .then((entries) => entries)
      .catch(() => [] as string[]),
  );

  let candidate = base;
  let suffix = 2;
  while (registered.has(candidate) || onDisk.has(candidate)) {
    candidate = `${base}-${suffix++}`;
  }
  return candidate;
}

/**
 * Creates a brand-new PM2-kind project from scratch: a fresh, empty
 * directory under APPS_ROOT registered as a project, so it's immediately
 * usable with every dirName-based feature (terminal, files, deploy) even
 * though no code exists yet. Used by Emmy's "Ergebnis in neues Projekt
 * umsetzen" flow — the caller pastes the research result into the project's
 * terminal session right after this resolves, so a Claude Code session
 * starts working in the directory as its first act.
 *
 * pm2Name/startScript are placeholders: nothing runnable exists yet, so
 * starting the PM2 process will fail until the terminal session (or the
 * user) actually scaffolds an app here — same as if a user manually created
 * an empty project and typed an arbitrary start script before writing code.
 */
export async function scaffoldProject(name: string): Promise<Project> {
  const dirName = await uniqueDirName(slugifyProjectName(name));
  const dir = path.join(config.APPS_ROOT, dirName);
  await fs.mkdir(dir, { recursive: true });
  return addProject({
    id: crypto.randomUUID(),
    dirName,
    pm2Name: dirName,
    startScript: "npm start",
  });
}

export async function removeProject(id: string): Promise<boolean> {
  return mutateProjects((current) => {
    const next = current.filter((p) => p.id !== id);
    if (next.length === current.length) return { next: current, result: false };
    return { next, result: true };
  });
}
