import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { EmmyChat, EmmyChatKind, EmmyMessage, EmmyTaskStatus, EmmyAttachment } from "@overlay/shared";

// Multi-chat store: one always-present general chat plus any number of task
// chats, each with its own message list. Mirrors ideachat-store.ts's
// read-cache / serialized-write-queue / tmp-rename pattern. Chats and their
// messages live together in one JSON file, keyed the same way idea-chats.json
// keeps several chats side by side.
const STORE_FILE = path.join(process.cwd(), "data", "emmy-chats.json");
const TMP_FILE = `${STORE_FILE}.tmp`;

interface StoreShape {
  chats: EmmyChat[];
  messages: EmmyMessage[];
}

export const GENERAL_CHAT_ID = "general";

let cache: StoreShape | null = null;
let writeQueue: Promise<unknown> = Promise.resolve();

async function readFromDisk(): Promise<StoreShape> {
  try {
    const raw = await fs.readFile(STORE_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<StoreShape>;
    return { chats: parsed.chats ?? [], messages: parsed.messages ?? [] };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { chats: [], messages: [] };
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
  // The general chat is guaranteed to exist so the UI always has a home for
  // casual, non-task messages — created lazily on first access.
  if (!cache.chats.some((c) => c.id === GENERAL_CHAT_ID)) {
    const now = new Date().toISOString();
    const general: EmmyChat = {
      id: GENERAL_CHAT_ID,
      kind: "general",
      title: "Allgemein",
      status: "open",
      createdAt: now,
      updatedAt: now,
    };
    cache.chats = [general, ...cache.chats];
    await writeToDisk(cache);
  }
  return cache;
}

export async function listChats(): Promise<EmmyChat[]> {
  const store = await ensureLoaded();
  // Newest activity first, but the general chat is always pinned to the top.
  return [...store.chats].sort((a, b) => {
    if (a.id === GENERAL_CHAT_ID) return -1;
    if (b.id === GENERAL_CHAT_ID) return 1;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

export async function getChat(id: string): Promise<EmmyChat | undefined> {
  const store = await ensureLoaded();
  return store.chats.find((c) => c.id === id);
}

export async function createChat(kind: EmmyChatKind, title: string): Promise<EmmyChat> {
  const store = await ensureLoaded();
  const now = new Date().toISOString();
  const chat: EmmyChat = {
    id: crypto.randomUUID(),
    kind,
    title: title.trim() || "Neue Aufgabe",
    status: "open",
    createdAt: now,
    updatedAt: now,
  };
  const next = { ...store, chats: [...store.chats, chat] };
  await writeToDisk(next);
  cache = next;
  return chat;
}

export async function updateChat(
  id: string,
  patch: { title?: string; status?: EmmyTaskStatus },
): Promise<EmmyChat | undefined> {
  const store = await ensureLoaded();
  const chat = store.chats.find((c) => c.id === id);
  if (!chat) return undefined;
  const updated: EmmyChat = {
    ...chat,
    ...(patch.title !== undefined ? { title: patch.title.trim() || chat.title } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    updatedAt: new Date().toISOString(),
  };
  const next = { ...store, chats: store.chats.map((c) => (c.id === id ? updated : c)) };
  await writeToDisk(next);
  cache = next;
  return updated;
}

/** Deletes the chat and all its messages. The general chat cannot be deleted. Returns false if not found / not deletable. */
export async function deleteChat(id: string): Promise<boolean> {
  if (id === GENERAL_CHAT_ID) return false;
  const store = await ensureLoaded();
  if (!store.chats.some((c) => c.id === id)) return false;
  const next = {
    chats: store.chats.filter((c) => c.id !== id),
    messages: store.messages.filter((m) => m.chatId !== id),
  };
  await writeToDisk(next);
  cache = next;
  return true;
}

export async function listMessages(chatId: string): Promise<EmmyMessage[]> {
  const store = await ensureLoaded();
  return store.messages.filter((m) => m.chatId === chatId);
}

export async function appendMessage(
  chatId: string,
  role: EmmyMessage["role"],
  text: string,
  attachments?: EmmyAttachment[],
): Promise<EmmyMessage> {
  const store = await ensureLoaded();
  const message: EmmyMessage = {
    id: crypto.randomUUID(),
    chatId,
    role,
    text,
    at: new Date().toISOString(),
    ...(attachments && attachments.length > 0 ? { attachments } : {}),
  };
  const chats = store.chats.map((c) => (c.id === chatId ? { ...c, updatedAt: message.at } : c));
  const next = { chats, messages: [...store.messages, message] };
  await writeToDisk(next);
  cache = next;
  return message;
}
