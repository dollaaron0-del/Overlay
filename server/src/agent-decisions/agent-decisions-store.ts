import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { AgentDecision } from "@overlay/shared";

// Flat append-only log of agent decisions, one JSON file — same read-cache /
// serialized-write-queue / tmp-rename pattern as emmy-store.ts. No delete/edit
// yet: a decision record is a historical fact once posted.
const STORE_FILE = path.join(process.cwd(), "data", "agent-decisions.json");
const TMP_FILE = `${STORE_FILE}.tmp`;

interface StoreShape {
  decisions: AgentDecision[];
}

let cache: StoreShape | null = null;
let writeQueue: Promise<unknown> = Promise.resolve();

async function readFromDisk(): Promise<StoreShape> {
  try {
    const raw = await fs.readFile(STORE_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<StoreShape>;
    return { decisions: parsed.decisions ?? [] };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { decisions: [] };
    throw err;
  }
}

async function writeToDisk(store: StoreShape): Promise<void> {
  writeQueue = writeQueue.then(async () => {
    await fs.mkdir(path.dirname(STORE_FILE), { recursive: true });
    await fs.writeFile(TMP_FILE, JSON.stringify(store, null, 2), "utf8");
    await fs.rename(TMP_FILE, STORE_FILE);
  });
  await writeQueue;
}

async function ensureLoaded(): Promise<StoreShape> {
  if (cache === null) cache = await readFromDisk();
  return cache;
}

/** Newest first; filtered to one project when `projectId` is given. */
export async function listDecisions(projectId?: string): Promise<AgentDecision[]> {
  const store = await ensureLoaded();
  const decisions = projectId ? store.decisions.filter((d) => d.projectId === projectId) : store.decisions;
  return [...decisions].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function createDecision(input: {
  agentId: string;
  projectId?: string;
  title: string;
  outcome: string;
  reasoning: string;
  sources: AgentDecision["sources"];
  sentiment?: AgentDecision["sentiment"];
}): Promise<AgentDecision> {
  const store = await ensureLoaded();
  const decision: AgentDecision = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    ...input,
  };
  const next: StoreShape = { decisions: [...store.decisions, decision] };
  await writeToDisk(next);
  cache = next;
  return decision;
}
