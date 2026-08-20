import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type {
  EmmyArchiveEntry,
  EmmyArchiveSummary,
  EmmyCategory,
  EmmyCategorySource,
  EmmyChat,
  EmmyChatKind,
  EmmyMessage,
  EmmyResearchPhase,
  EmmyTaskStatus,
  EmmyAttachment,
} from "@overlay/shared";

// Multi-chat store: one always-present general chat plus any number of task
// chats, each with its own message list. Mirrors ideachat-store.ts's
// read-cache / serialized-write-queue / tmp-rename pattern. Chats, their
// messages and the archive of deleted conversations live together in one JSON
// file, keyed the same way idea-chats.json keeps several chats side by side —
// one file means archiving-then-deleting is a single atomic write.
const STORE_FILE = path.join(process.cwd(), "data", "emmy-chats.json");
const TMP_FILE = `${STORE_FILE}.tmp`;

interface StoreShape {
  chats: EmmyChat[];
  messages: EmmyMessage[];
  archive: EmmyArchiveEntry[];
}

export const GENERAL_CHAT_ID = "general";

let cache: StoreShape | null = null;
// Kept always-resolving (see queuedWrite below) so one failed write can't
// wedge every subsequent one behind a permanently-rejected chain.
let writeQueue: Promise<unknown> = Promise.resolve();

async function readFromDisk(): Promise<StoreShape> {
  try {
    const raw = await fs.readFile(STORE_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<StoreShape>;
    return { chats: parsed.chats ?? [], messages: parsed.messages ?? [], archive: parsed.archive ?? [] };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { chats: [], messages: [], archive: [] };
    throw err;
  }
}

async function writeStoreFile(store: StoreShape): Promise<void> {
  await fs.mkdir(path.dirname(STORE_FILE), { recursive: true });
  await fs.writeFile(TMP_FILE, JSON.stringify(store, null, 2), "utf8");
  await fs.rename(TMP_FILE, STORE_FILE);
}

/** Runs `task` serialized behind every other queued write, so no two mutations ever race each other's read-modify-write cycle. */
function queuedWrite<T>(task: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(task);
  writeQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Runs a read-modify-write against the store, fully serialized through
 * queuedWrite — `fn` only ever sees the latest committed state. Without this,
 * two concurrent mutations (e.g. two rapid messages, or the recurring-tasks
 * scheduler ticking a chat while a user edits it) would both compute `next`
 * from the same pre-write snapshot, and whichever write lands second would
 * silently discard the first's change. `fn` returns the unchanged `current`
 * object (by reference) to signal a no-op — skips the disk write entirely.
 */
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

async function ensureLoaded(): Promise<StoreShape> {
  if (cache === null) cache = await readFromDisk();
  // The general chat is guaranteed to exist so the UI always has a home for
  // casual, non-task messages — created lazily on first access.
  if (!cache.chats.some((c) => c.id === GENERAL_CHAT_ID)) {
    return queuedWrite(async () => {
      // Re-check inside the queue: another concurrent ensureLoaded() call may
      // have already created it while this one was waiting its turn.
      if (cache!.chats.some((c) => c.id === GENERAL_CHAT_ID)) return cache!;
      const now = new Date().toISOString();
      const general: EmmyChat = {
        id: GENERAL_CHAT_ID,
        kind: "general",
        title: "Allgemein",
        status: "open",
        createdAt: now,
        updatedAt: now,
      };
      const next = { ...cache!, chats: [general, ...cache!.chats] };
      await writeStoreFile(next);
      cache = next;
      return next;
    });
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

/**
 * Category fields a chat can carry; passed in at creation and patchable later.
 * `undefined` leaves a field untouched, `null` clears it — a task that stops
 * being a research task must be able to lose its deadline.
 */
export interface EmmyCategoryPatch {
  category?: EmmyCategory;
  categorySource?: EmmyCategorySource;
  dueAt?: string | null;
  intervalHours?: number | null;
}

export async function createChat(
  kind: EmmyChatKind,
  title: string,
  categorization?: EmmyCategoryPatch,
): Promise<EmmyChat> {
  const now = new Date().toISOString();
  const chat: EmmyChat = {
    id: crypto.randomUUID(),
    kind,
    title: title.trim() || "Neue Aufgabe",
    status: "open",
    createdAt: now,
    updatedAt: now,
  };
  return mutateStore((store) => {
    const next = {
      ...store,
      chats: [...store.chats, kind === "task" ? applyPatch(chat, categorization ?? {}) : chat],
    };
    return { next, result: next.chats[next.chats.length - 1] };
  });
}

/** Merges a patch onto a chat: `undefined` keeps the current value, `null` removes the field. */
function applyPatch(chat: EmmyChat, patch: object): EmmyChat {
  const next: Record<string, unknown> = { ...chat };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (value === null) delete next[key];
    else next[key] = value;
  }
  return next as unknown as EmmyChat;
}

export async function updateChat(
  id: string,
  patch: {
    title?: string;
    status?: EmmyTaskStatus;
    sourcesSearched?: number;
    knowledgeLevel?: number;
    researchPhase?: EmmyResearchPhase;
    pendingFinalDocument?: boolean;
    /** Only set by the recurring-tasks scheduler (emmy-scheduler.ts). */
    lastRecurringCheckAt?: string;
    /** Only set by the research-due-check scheduler tick (emmy-scheduler.ts). */
    dueCheckSentAt?: string;
  } & EmmyCategoryPatch,
): Promise<EmmyChat | undefined> {
  return mutateStore((store) => {
    const chat = store.chats.find((c) => c.id === id);
    if (!chat) return { next: store, result: undefined };
    const { title, ...rest } = patch;
    const updated: EmmyChat = {
      ...applyPatch(chat, rest),
      ...(title !== undefined ? { title: title.trim() || chat.title } : {}),
      updatedAt: new Date().toISOString(),
    };
    const next = { ...store, chats: store.chats.map((c) => (c.id === id ? updated : c)) };
    return { next, result: updated };
  });
}

/**
 * Clears a conversation out of the live list — but keeps every message.
 *
 * Deleting is about getting a chat out of the way, never about destroying what
 * was said, so the chat and its messages move to the archive verbatim (and the
 * attachment files stay on disk, still referenced by the archived messages).
 * The general chat is the one conversation that cannot disappear, so it is
 * emptied instead of removed: its history is archived and it stays, blank, at
 * the top of the list.
 *
 * Returns false only if there is no such chat.
 */
export async function deleteChat(id: string): Promise<boolean> {
  return mutateStore((store) => {
    const chat = store.chats.find((c) => c.id === id);
    if (!chat) return { next: store, result: false };

    const messages = store.messages.filter((m) => m.chatId === id);
    const now = new Date().toISOString();
    const archive =
      messages.length > 0
        ? [...store.archive, { id: crypto.randomUUID(), chat, messages, archivedAt: now }]
        : store.archive;

    const next: StoreShape = {
      chats:
        id === GENERAL_CHAT_ID
          ? store.chats.map((c) => (c.id === id ? { ...c, updatedAt: now } : c))
          : store.chats.filter((c) => c.id !== id),
      messages: store.messages.filter((m) => m.chatId !== id),
      archive,
    };
    return { next, result: true };
  });
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
  isFinalDocument?: boolean,
  needsClarification?: boolean,
): Promise<EmmyMessage> {
  const message: EmmyMessage = {
    id: crypto.randomUUID(),
    chatId,
    role,
    text,
    at: new Date().toISOString(),
    ...(attachments && attachments.length > 0 ? { attachments } : {}),
    ...(isFinalDocument ? { isFinalDocument: true } : {}),
    ...(needsClarification ? { needsClarification: true } : {}),
  };
  return mutateStore((store) => {
    const chats = store.chats.map((c) => (c.id === chatId ? { ...c, updatedAt: message.at } : c));
    const next = { ...store, chats, messages: [...store.messages, message] };
    return { next, result: message };
  });
}

// ---- archive -----------------------------------------------------------------

/** Newest archived conversation first. */
export async function listArchive(): Promise<EmmyArchiveSummary[]> {
  const store = await ensureLoaded();
  return [...store.archive]
    .sort((a, b) => b.archivedAt.localeCompare(a.archivedAt))
    .map((entry) => ({
      id: entry.id,
      chatId: entry.chat.id,
      title: entry.chat.title,
      kind: entry.chat.kind,
      ...(entry.chat.category ? { category: entry.chat.category } : {}),
      archivedAt: entry.archivedAt,
      messageCount: entry.messages.length,
    }));
}

export async function getArchiveEntry(id: string): Promise<EmmyArchiveEntry | undefined> {
  const store = await ensureLoaded();
  return store.archive.find((e) => e.id === id);
}

/** Every archived message that once belonged to this chat — used to keep old attachment links working. */
export async function listArchivedMessages(chatId: string): Promise<EmmyMessage[]> {
  const store = await ensureLoaded();
  return store.archive.filter((e) => e.chat.id === chatId).flatMap((e) => e.messages);
}

/** Permanent removal — the one call that really does throw a conversation away. */
export async function purgeArchiveEntry(id: string): Promise<boolean> {
  return mutateStore((store) => {
    if (!store.archive.some((e) => e.id === id)) return { next: store, result: false };
    const next = { ...store, archive: store.archive.filter((e) => e.id !== id) };
    return { next, result: true };
  });
}
