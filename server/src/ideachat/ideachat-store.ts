import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { IdeaChat, IdeaChatMessage } from "./ideachat.types.js";

const STORE_FILE = path.join(process.cwd(), "data", "idea-chats.json");
const TMP_FILE = `${STORE_FILE}.tmp`;

let cache: IdeaChat[] | null = null;
// Kept always-resolving (see queuedWrite below) so one failed write can't
// wedge every subsequent one behind a permanently-rejected chain.
let writeQueue: Promise<unknown> = Promise.resolve();

async function readFromDisk(): Promise<IdeaChat[]> {
  try {
    const raw = await fs.readFile(STORE_FILE, "utf8");
    return JSON.parse(raw) as IdeaChat[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

async function writeStoreFile(chats: IdeaChat[]): Promise<void> {
  await fs.mkdir(path.dirname(STORE_FILE), { recursive: true });
  await fs.writeFile(TMP_FILE, JSON.stringify(chats, null, 2), "utf8");
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

async function ensureLoaded(): Promise<IdeaChat[]> {
  if (cache === null) cache = await readFromDisk();
  return cache;
}

/**
 * Runs a read-modify-write against the store, fully serialized through
 * queuedWrite — `fn` only ever sees the latest committed state. Without this,
 * two concurrent mutations (e.g. two rapid turns in the same chat) would both
 * compute `next` from the same pre-write snapshot, and whichever write lands
 * second would silently discard the first's change. `fn` returns the
 * unchanged `current` array (by reference) to signal a no-op.
 */
async function mutateStore<T>(fn: (current: IdeaChat[]) => { next: IdeaChat[]; result: T }): Promise<T> {
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

/** Most-recently-updated first, for the chat list view. */
export async function listIdeaChats(): Promise<IdeaChat[]> {
  const chats = await ensureLoaded();
  return [...chats].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getIdeaChat(id: string): Promise<IdeaChat | undefined> {
  const chats = await ensureLoaded();
  return chats.find((c) => c.id === id);
}

function deriveTitle(firstMessage: string): string {
  const oneLine = firstMessage.replace(/\s+/g, " ").trim();
  return oneLine.length > 60 ? `${oneLine.slice(0, 60)}…` : oneLine;
}

export async function createIdeaChat(projectId: string, firstUserMessage: string): Promise<IdeaChat> {
  const now = new Date().toISOString();
  const chat: IdeaChat = {
    id: crypto.randomUUID(),
    projectId,
    title: deriveTitle(firstUserMessage),
    claudeSessionId: null,
    messages: [{ role: "user", text: firstUserMessage, at: now }],
    createdAt: now,
    updatedAt: now,
  };
  return mutateStore((chats) => ({ next: [...chats, chat], result: chat }));
}

/**
 * Appends one or more messages (e.g. the user's turn and the assistant's
 * reply together) and records the resumable claude session id — null if
 * this turn was answered by a local Ollama tier and Claude still hasn't
 * been involved in this chat at all (see tiered-answer.ts).
 */
export async function appendIdeaChatMessages(
  id: string,
  newMessages: IdeaChatMessage[],
  claudeSessionId: string | null,
): Promise<IdeaChat | undefined> {
  return mutateStore((chats) => {
    const index = chats.findIndex((c) => c.id === id);
    if (index === -1) return { next: chats, result: undefined };

    const updated: IdeaChat = {
      ...chats[index],
      messages: [...chats[index].messages, ...newMessages],
      claudeSessionId,
      updatedAt: new Date().toISOString(),
    };
    const next = [...chats];
    next[index] = updated;
    return { next, result: updated };
  });
}
