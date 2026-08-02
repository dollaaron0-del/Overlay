import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { EmmyMessage } from "@overlay/shared";

// Single conversation (unlike idea-chats.json, no per-project multi-chat
// list here) — see ideachat-store.ts for the read-cache/write-queue/tmp-
// rename pattern this mirrors.
const STORE_FILE = path.join(process.cwd(), "data", "emmy-messages.json");
const TMP_FILE = `${STORE_FILE}.tmp`;

let cache: EmmyMessage[] | null = null;
let writeQueue: Promise<unknown> = Promise.resolve();

async function readFromDisk(): Promise<EmmyMessage[]> {
  try {
    const raw = await fs.readFile(STORE_FILE, "utf8");
    return JSON.parse(raw) as EmmyMessage[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

async function writeToDisk(messages: EmmyMessage[]): Promise<void> {
  writeQueue = writeQueue.then(async () => {
    await fs.mkdir(path.dirname(STORE_FILE), { recursive: true });
    await fs.writeFile(TMP_FILE, JSON.stringify(messages, null, 2), "utf8");
    await fs.rename(TMP_FILE, STORE_FILE);
  });
  await writeQueue;
}

async function ensureLoaded(): Promise<EmmyMessage[]> {
  if (cache === null) cache = await readFromDisk();
  return cache;
}

export async function listEmmyMessages(): Promise<EmmyMessage[]> {
  return ensureLoaded();
}

export async function appendEmmyMessage(role: EmmyMessage["role"], text: string): Promise<EmmyMessage> {
  const messages = await ensureLoaded();
  const message: EmmyMessage = { id: crypto.randomUUID(), role, text, at: new Date().toISOString() };
  const next = [...messages, message];
  await writeToDisk(next);
  cache = next;
  return message;
}
