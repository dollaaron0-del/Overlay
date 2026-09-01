import { readFile } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { getLastAnsweredModel } from "./emmy/emmy-store.js";

/**
 * Feeds the sidebar "Modelle" widget: which model each Emmy lane runs on, and
 * a small non-secret inventory of the Emmy gateway's provider accounts.
 *
 * The account inventory comes from a snapshot file
 * (data/model-status.json) written every 10 min by
 * deploy/model-status-snapshot.sh, which runs as the `aaron` user because only
 * that user can read the Emmy gateway's state dir. This process (user
 * `overlay`) only ever reads the sanitized snapshot — no gateway RPC, no
 * credentials. The lane routing is known here directly from config.
 */

const SNAPSHOT_PATH = path.join(process.cwd(), "data", "model-status.json");
const STALE_AFTER_MS = 30 * 60 * 1000;
const CACHE_MS = 15_000;

interface Snapshot {
  generatedAt: string;
  instance: string;
  default: string | null;
  fallbacks: string[];
  claudeAccounts: number;
  geminiKeys: number;
}

export interface ModelLane {
  key: "default" | "recurring" | "research";
  label: string;
  model: string | null;
  fallback: string | null;
}

export interface ModelStatus {
  lanes: ModelLane[];
  /**
   * The model that actually produced the most recent Emmy reply (any chat),
   * as she self-reported it — the honest "which AI is answering me" signal
   * that the lane config above can't give (it can't see which fallback tier
   * a turn resolved to). Null until a reply has carried a model.
   */
  lastAnswered: { model: string; at: string; ageSeconds: number } | null;
  instance:
    | {
        name: string;
        claudeAccounts: number;
        geminiKeys: number;
        generatedAt: string;
        ageSeconds: number;
        stale: boolean;
      }
    | null;
}

let cache: { at: number; value: ModelStatus } | null = null;

async function readSnapshot(): Promise<Snapshot | null> {
  try {
    const parsed = JSON.parse(await readFile(SNAPSHOT_PATH, "utf8")) as Partial<Snapshot>;
    if (!parsed || typeof parsed.generatedAt !== "string") return null;
    return {
      generatedAt: parsed.generatedAt,
      instance: typeof parsed.instance === "string" ? parsed.instance : "emmy",
      default: typeof parsed.default === "string" ? parsed.default : null,
      fallbacks: Array.isArray(parsed.fallbacks) ? parsed.fallbacks.filter((m): m is string => typeof m === "string") : [],
      claudeAccounts: Number.isFinite(parsed.claudeAccounts) ? Number(parsed.claudeAccounts) : 0,
      geminiKeys: Number.isFinite(parsed.geminiKeys) ? Number(parsed.geminiKeys) : 0,
    };
  } catch {
    return null; // missing or unreadable — widget shows lanes only
  }
}

export async function getModelStatus(): Promise<ModelStatus> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;

  const snap = await readSnapshot();
  const gatewayDefault = snap?.default ?? null;

  const lanes: ModelLane[] = [
    {
      key: "default",
      label: "Chat / Standard",
      model: gatewayDefault,
      fallback: snap?.fallbacks[0] ?? null,
    },
    {
      key: "recurring",
      label: "Wiederkehrende Checks",
      model: config.EMMY_RECURRING_MODEL || gatewayDefault,
      fallback: config.EMMY_RECURRING_FALLBACK_MODEL || null,
    },
    {
      key: "research",
      label: "Tiefe Recherche",
      model: config.EMMY_RESEARCH_MODEL || gatewayDefault,
      fallback: config.EMMY_RESEARCH_FALLBACK_MODEL || null,
    },
  ];

  let instance: ModelStatus["instance"] = null;
  if (snap) {
    const ageMs = Date.now() - new Date(snap.generatedAt).getTime();
    instance = {
      name: snap.instance,
      claudeAccounts: snap.claudeAccounts,
      geminiKeys: snap.geminiKeys,
      generatedAt: snap.generatedAt,
      ageSeconds: Math.max(0, Math.round(ageMs / 1000)),
      stale: !Number.isFinite(ageMs) || ageMs > STALE_AFTER_MS,
    };
  }

  let lastAnswered: ModelStatus["lastAnswered"] = null;
  const last = await getLastAnsweredModel().catch(() => null);
  if (last) {
    const ageMs = Date.now() - new Date(last.at).getTime();
    lastAnswered = {
      model: last.model,
      at: last.at,
      ageSeconds: Number.isFinite(ageMs) ? Math.max(0, Math.round(ageMs / 1000)) : 0,
    };
  }

  const value: ModelStatus = { lanes, lastAnswered, instance };
  cache = { at: Date.now(), value };
  return value;
}
