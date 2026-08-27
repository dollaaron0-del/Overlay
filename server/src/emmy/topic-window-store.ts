import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { EmmyTopicWindow, EmmyTopicWindowPatch } from "@overlay/shared";

// Same read-cache / serialized-write-queue / tmp-rename pattern as
// emmy-store.ts. Topic windows are small and few, so the whole list lives in
// one JSON file and is always sent/broadcast whole.
const STORE_FILE = path.join(process.cwd(), "data", "topic-windows.json");
const TMP_FILE = `${STORE_FILE}.tmp`;

interface StoreShape {
  windows: EmmyTopicWindow[];
}

const DEFAULT_GEOMETRY = { x: 140, y: 90, w: 540, h: 460 };

let cache: StoreShape | null = null;
let writeQueue: Promise<unknown> = Promise.resolve();

async function readFromDisk(): Promise<StoreShape> {
  try {
    const raw = await fs.readFile(STORE_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<StoreShape>;
    return { windows: parsed.windows ?? [] };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { windows: [] };
    throw err;
  }
}

async function writeStoreFile(store: StoreShape): Promise<void> {
  await fs.mkdir(path.dirname(STORE_FILE), { recursive: true });
  await fs.writeFile(TMP_FILE, JSON.stringify(store, null, 2), "utf8");
  await fs.rename(TMP_FILE, STORE_FILE);
}

function queuedWrite<T>(task: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(task);
  writeQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function ensureLoaded(): Promise<StoreShape> {
  if (cache === null) cache = await readFromDisk();
  return cache;
}

async function mutateStore<T>(fn: (current: StoreShape) => { next: StoreShape; result: T }): Promise<T> {
  await ensureLoaded();
  return queuedWrite(async () => {
    const current = cache!;
    const { next, result } = fn(current);
    if (next !== current) {
      await writeStoreFile(next);
      cache = next;
    }
    return result;
  });
}

export async function listTopicWindows(): Promise<EmmyTopicWindow[]> {
  const store = await ensureLoaded();
  return [...store.windows].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function createTopicWindow(input: {
  title: string;
  content: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}): Promise<EmmyTopicWindow> {
  const now = new Date().toISOString();
  return mutateStore((store) => {
    // Stagger fresh windows so a burst of them doesn't stack exactly.
    const n = store.windows.filter((w) => !w.minimized).length;
    const win: EmmyTopicWindow = {
      id: crypto.randomUUID(),
      title: input.title.trim() || "Themen-Fenster",
      content: input.content,
      x: input.x ?? DEFAULT_GEOMETRY.x + (n % 6) * 28,
      y: input.y ?? DEFAULT_GEOMETRY.y + (n % 6) * 28,
      w: input.w ?? DEFAULT_GEOMETRY.w,
      h: input.h ?? DEFAULT_GEOMETRY.h,
      minimized: false,
      createdAt: now,
      updatedAt: now,
    };
    return { next: { windows: [...store.windows, win] }, result: win };
  });
}

export async function patchTopicWindow(
  id: string,
  patch: EmmyTopicWindowPatch,
): Promise<EmmyTopicWindow | undefined> {
  return mutateStore((store) => {
    const win = store.windows.find((w) => w.id === id);
    if (!win) return { next: store, result: undefined };
    const updated: EmmyTopicWindow = {
      ...win,
      ...(patch.title !== undefined ? { title: patch.title.trim() || win.title } : {}),
      ...(patch.content !== undefined ? { content: patch.content } : {}),
      ...(patch.x !== undefined ? { x: patch.x } : {}),
      ...(patch.y !== undefined ? { y: patch.y } : {}),
      ...(patch.w !== undefined ? { w: patch.w } : {}),
      ...(patch.h !== undefined ? { h: patch.h } : {}),
      ...(patch.minimized !== undefined ? { minimized: patch.minimized } : {}),
      updatedAt: new Date().toISOString(),
    };
    return {
      next: { windows: store.windows.map((w) => (w.id === id ? updated : w)) },
      result: updated,
    };
  });
}

export async function deleteTopicWindow(id: string): Promise<boolean> {
  return mutateStore((store) => {
    if (!store.windows.some((w) => w.id === id)) return { next: store, result: false };
    return { next: { windows: store.windows.filter((w) => w.id !== id) }, result: true };
  });
}
