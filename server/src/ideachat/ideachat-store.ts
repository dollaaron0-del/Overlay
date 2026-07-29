import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { IdeaChat, IdeaChatMessage } from "./ideachat.types.js";

const STORE_FILE = path.join(process.cwd(), "data", "idea-chats.json");
const TMP_FILE = `${STORE_FILE}.tmp`;

let cache: IdeaChat[] | null = null;
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

async function writeToDisk(chats: IdeaChat[]): Promise<void> {
  writeQueue = writeQueue.then(async () => {
    await fs.mkdir(path.dirname(STORE_FILE), { recursive: true });
    await fs.writeFile(TMP_FILE, JSON.stringify(chats, null, 2), "utf8");
    await fs.rename(TMP_FILE, STORE_FILE);
  });
  await writeQueue;
}

async function ensureLoaded(): Promise<IdeaChat[]> {
  if (cache === null) cache = await readFromDisk();
  return cache;
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
  const chats = await ensureLoaded();
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
  const next = [...chats, chat];
  await writeToDisk(next);
  cache = next;
  return chat;
}

/** Appends one or more messages (e.g. the user's turn and the assistant's reply together) and records the resumable claude session id. */
export async function appendIdeaChatMessages(
  id: string,
  newMessages: IdeaChatMessage[],
  claudeSessionId: string,
): Promise<IdeaChat | undefined> {
  const chats = await ensureLoaded();
  const index = chats.findIndex((c) => c.id === id);
  if (index === -1) return undefined;

  const updated: IdeaChat = {
    ...chats[index],
    messages: [...chats[index].messages, ...newMessages],
    claudeSessionId,
    updatedAt: new Date().toISOString(),
  };
  const next = [...chats];
  next[index] = updated;
  await writeToDisk(next);
  cache = next;
  return updated;
}
