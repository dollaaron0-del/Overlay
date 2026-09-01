import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Feeds the sidebar "Aufgaben" panel: Emmy's standing delegated tasks
 * (workspace tasks/<slug>/) with their goal, status and recent results.
 *
 * Same privilege-separation pattern as system-models.ts: this process (user
 * `overlay`) cannot read Emmy's workspace, so a snapshot file
 * (data/tasks-snapshot.json) is written every 10 min by
 * scripts/overlay-tasks-snapshot.py running as the `aaron` user. We only ever
 * read the sanitized snapshot — no money/ledger data is included in it.
 */

const SNAPSHOT_PATH = path.join(process.cwd(), "data", "tasks-snapshot.json");
const STALE_AFTER_MS = 60 * 60 * 1000;
const CACHE_MS = 15_000;

export interface TaskLogEntry {
  ts?: string;
  run?: string;
  action?: string;
  digest?: string;
  observed?: string;
  result?: string;
  [k: string]: unknown;
}

export interface TaskPanelItem {
  slug: string;
  title: string;
  status: string;
  ziel: string | null;
  erfolgskriterium: string | null;
  meldeTakt: string | null;
  angelegt: string | null;
  hatLedger: boolean;
  lastActivity: string | null;
  logCount: number;
  recentLog: TaskLogEntry[];
  mandateLog: string[];
  offenePunkte: string[];
}

export interface TasksPanel {
  tasks: TaskPanelItem[];
  generatedAt: string | null;
  ageSeconds: number | null;
  stale: boolean;
}

interface Snapshot {
  generatedAt?: unknown;
  tasks?: unknown;
}

let cache: { at: number; value: TasksPanel } | null = null;

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function normaliseTask(raw: unknown): TaskPanelItem | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Record<string, unknown>;
  const slug = str(t.slug);
  if (!slug) return null;
  return {
    slug,
    title: str(t.title) ?? slug,
    status: str(t.status) ?? "aktiv",
    ziel: str(t.ziel),
    erfolgskriterium: str(t.erfolgskriterium),
    meldeTakt: str(t.meldeTakt),
    angelegt: str(t.angelegt),
    hatLedger: t.hatLedger === true,
    lastActivity: str(t.lastActivity),
    logCount: Number.isFinite(t.logCount) ? Number(t.logCount) : 0,
    recentLog: Array.isArray(t.recentLog)
      ? (t.recentLog.filter((e) => e && typeof e === "object") as TaskLogEntry[])
      : [],
    mandateLog: strArray(t.mandateLog),
    offenePunkte: strArray(t.offenePunkte),
  };
}

async function readSnapshot(): Promise<{ tasks: TaskPanelItem[]; generatedAt: string | null }> {
  try {
    const parsed = JSON.parse(await readFile(SNAPSHOT_PATH, "utf8")) as Snapshot;
    const tasks = Array.isArray(parsed.tasks)
      ? parsed.tasks.map(normaliseTask).filter((t): t is TaskPanelItem => t !== null)
      : [];
    return { tasks, generatedAt: str(parsed.generatedAt) };
  } catch {
    return { tasks: [], generatedAt: null };
  }
}

export async function getTasksPanel(): Promise<TasksPanel> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;

  const { tasks, generatedAt } = await readSnapshot();
  const ageMs = generatedAt ? Date.now() - new Date(generatedAt).getTime() : null;
  const value: TasksPanel = {
    tasks,
    generatedAt,
    ageSeconds: ageMs == null ? null : Math.max(0, Math.round(ageMs / 1000)),
    stale: ageMs == null || ageMs > STALE_AFTER_MS,
  };
  cache = { at: Date.now(), value };
  return value;
}
