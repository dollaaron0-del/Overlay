import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { generateOllamaCompletion, generateOllamaEmbedding } from "../security/ollama-client.js";
import { attachmentsDir } from "./emmy-attachments.js";
import { listChats, listMessages, listArchive, getArchiveEntry } from "./emmy-store.js";
import type { EmmyAttachment, EmmyMessage } from "@overlay/shared";

/**
 * Cross-conversation memory for Emmy: every message, in every chat — including
 * deleted ones (emmy-store.ts keeps those verbatim in its archive) — gets
 * embedded via a local Ollama model and cached here. A new message is
 * embedded the same way and cosine-matched against that cache, so Emmy can
 * recall something discussed in a different chat without it being repasted —
 * the same idea as Claude.ai's cross-conversation memory.
 *
 * Entirely optional and best-effort, same convention as every other Ollama
 * feature in this codebase (see security/ollama-client.ts, ideachat-ollama.ts):
 * an empty EMMY_MEMORY_EMBEDDING_MODEL means no network call is ever
 * attempted, and any failure here must never surface as a broken chat send —
 * memory is a nice-to-have on top of the always-on recent-history context
 * built directly in emmy.routes.ts's buildPrompt().
 *
 * Non-goal: documents/PDFs are indexed by filename only, no text extraction.
 */

const STORE_FILE = path.join(process.cwd(), "data", "emmy-memory-index.json");
const TMP_FILE = `${STORE_FILE}.tmp`;
const MAX_INDEX_TEXT_CHARS = 4000;

export interface MemoryEntry {
  chatId: string;
  /** Denormalized so a hit still shows where it came from after that chat is deleted. */
  chatTitle: string;
  role: EmmyMessage["role"];
  indexedText: string;
  embedding: number[];
  at: string;
}

export interface MemoryHit {
  chatId: string;
  chatTitle: string;
  role: EmmyMessage["role"];
  snippet: string;
  at: string;
  score: number;
}

export interface EmmyMemoryDeps {
  embed: (baseUrl: string, model: string, text: string, timeoutMs: number) => Promise<number[]>;
  /** Returns a short caption for a base64-encoded image, via a vision model. */
  caption: (baseUrl: string, model: string, imageBase64: string, timeoutMs: number) => Promise<string>;
}

export const defaultDeps: EmmyMemoryDeps = {
  embed: generateOllamaEmbedding,
  caption: async (baseUrl, model, imageBase64, timeoutMs) => {
    const prompt = "Beschreibe kurz und knapp auf Deutsch, was auf diesem Bild zu sehen ist.";
    return generateOllamaCompletion(baseUrl, model, prompt, timeoutMs, undefined, [imageBase64]);
  },
};

// ---- pure helpers (no config, no I/O) ----------------------------------------

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function truncateForPrompt(text: string, maxChars: number): string {
  const trimmed = text.trim();
  return trimmed.length > maxChars ? `${trimmed.slice(0, maxChars)}…` : trimmed;
}

/** Message text + attachment names + any image captions, capped so one giant message can't dominate an entry. */
export function buildIndexableText(
  text: string,
  attachments?: EmmyAttachment[],
  captions?: Record<string, string>,
): string {
  const parts = [text.trim()];
  for (const attachment of attachments ?? []) {
    parts.push(`Anhang: ${attachment.originalName}`);
    const caption = captions?.[attachment.filename];
    if (caption) parts.push(`Bildbeschreibung von ${attachment.originalName}: ${caption}`);
  }
  return truncateForPrompt(parts.filter(Boolean).join("\n"), MAX_INDEX_TEXT_CHARS);
}

export function rankMemoryEntries(
  entries: [string, MemoryEntry][],
  queryEmbedding: number[],
  excludeIds: Set<string>,
  topK: number,
  minScore: number,
): MemoryHit[] {
  const scored: (MemoryHit & { id: string })[] = [];
  for (const [id, entry] of entries) {
    if (excludeIds.has(id)) continue;
    const score = cosineSimilarity(queryEmbedding, entry.embedding);
    if (score < minScore) continue;
    scored.push({
      id,
      chatId: entry.chatId,
      chatTitle: entry.chatTitle,
      role: entry.role,
      snippet: truncateForPrompt(entry.indexedText, 500),
      at: entry.at,
      score,
    });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).map(({ id: _id, ...hit }) => hit);
}

// ---- persisted index: cache / serialized write queue / tmp-rename -----------
// Same pattern as emmy-store.ts.

type IndexShape = Record<string, MemoryEntry>;

let cache: IndexShape | null = null;
let writeQueue: Promise<unknown> = Promise.resolve();

async function readFromDisk(): Promise<IndexShape> {
  try {
    const raw = await fs.readFile(STORE_FILE, "utf8");
    return JSON.parse(raw) as IndexShape;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
}

async function writeToDisk(index: IndexShape): Promise<void> {
  writeQueue = writeQueue.then(async () => {
    await fs.mkdir(path.dirname(STORE_FILE), { recursive: true });
    await fs.writeFile(TMP_FILE, JSON.stringify(index), "utf8");
    await fs.rename(TMP_FILE, STORE_FILE);
  });
  await writeQueue;
}

async function ensureLoaded(): Promise<IndexShape> {
  if (cache === null) cache = await readFromDisk();
  return cache;
}

// ---- Ollama-backed operations, all best-effort -------------------------------

async function captionImageAttachments(
  chatId: string,
  attachments: EmmyAttachment[],
  deps: EmmyMemoryDeps,
): Promise<Record<string, string>> {
  const captions: Record<string, string> = {};
  if (!config.EMMY_MEMORY_VISION_MODEL) return captions;

  for (const attachment of attachments) {
    if (attachment.kind !== "image") continue;
    try {
      const filePath = path.join(attachmentsDir(chatId), attachment.filename);
      const bytes = await fs.readFile(filePath);
      captions[attachment.filename] = await deps.caption(
        config.EMMY_MEMORY_OLLAMA_URL,
        config.EMMY_MEMORY_VISION_MODEL,
        bytes.toString("base64"),
        config.EMMY_MEMORY_VISION_TIMEOUT_MS,
      );
    } catch (err) {
      // One bad/unreadable image must not drop captions for the rest of the message.
      console.error(`[emmy-memory] caption failed for ${attachment.filename}: ${(err as Error).message}`);
    }
  }
  return captions;
}

/** Best-effort: embeds and persists one message. Never throws. Meant to be called unawaited. */
export async function indexMessageForMemory(
  message: EmmyMessage,
  chatTitle: string,
  deps: EmmyMemoryDeps = defaultDeps,
): Promise<void> {
  if (!config.EMMY_MEMORY_EMBEDDING_MODEL) return;
  try {
    const captions = await captionImageAttachments(message.chatId, message.attachments ?? [], deps);
    const indexedText = buildIndexableText(message.text, message.attachments, captions);
    if (!indexedText) return;

    const embedding = await deps.embed(
      config.EMMY_MEMORY_OLLAMA_URL,
      config.EMMY_MEMORY_EMBEDDING_MODEL,
      indexedText,
      config.EMMY_MEMORY_EMBEDDING_TIMEOUT_MS,
    );

    const index = await ensureLoaded();
    const next = {
      ...index,
      [message.id]: { chatId: message.chatId, chatTitle, role: message.role, indexedText, embedding, at: message.at },
    };
    await writeToDisk(next);
    cache = next;
  } catch (err) {
    console.error(`[emmy-memory] indexing failed for message ${message.id}: ${(err as Error).message}`);
  }
}

/** Best-effort: returns [] (no network call) if the feature isn't configured, and never throws. */
export async function retrieveMemory(
  queryText: string,
  excludeMessageIds: Set<string>,
  deps: EmmyMemoryDeps = defaultDeps,
): Promise<MemoryHit[]> {
  if (!config.EMMY_MEMORY_EMBEDDING_MODEL || !queryText.trim()) return [];
  try {
    const queryEmbedding = await deps.embed(
      config.EMMY_MEMORY_OLLAMA_URL,
      config.EMMY_MEMORY_EMBEDDING_MODEL,
      queryText,
      config.EMMY_MEMORY_EMBEDDING_TIMEOUT_MS,
    );
    const index = await ensureLoaded();
    return rankMemoryEntries(
      Object.entries(index),
      queryEmbedding,
      excludeMessageIds,
      config.EMMY_MEMORY_TOP_K,
      config.EMMY_MEMORY_MIN_SCORE,
    );
  } catch (err) {
    console.error(`[emmy-memory] retrieval failed: ${(err as Error).message}`);
    return [];
  }
}

/** Best-effort: drops index entries for permanently-deleted messages. Never throws. */
export async function purgeMessagesFromMemory(messageIds: string[]): Promise<void> {
  try {
    const index = await ensureLoaded();
    let changed = false;
    const next = { ...index };
    for (const id of messageIds) {
      if (id in next) {
        delete next[id];
        changed = true;
      }
    }
    if (!changed) return;
    await writeToDisk(next);
    cache = next;
  } catch (err) {
    console.error(`[emmy-memory] purge failed: ${(err as Error).message}`);
  }
}

/**
 * Backfills every existing message (live and archived) that predates this
 * feature, or was sent while Ollama was unreachable. Fired once at startup,
 * never awaited by its caller — walks the whole corpus sequentially so it
 * doesn't hammer a possibly modest local Ollama instance, and can never take
 * the process down.
 */
export async function reconcileMemoryIndex(deps: EmmyMemoryDeps = defaultDeps): Promise<void> {
  if (!config.EMMY_MEMORY_EMBEDDING_MODEL) return;
  try {
    const index = await ensureLoaded();

    const chats = await listChats();
    for (const chat of chats) {
      for (const message of await listMessages(chat.id)) {
        if (message.id in index) continue;
        await indexMessageForMemory(message, chat.title, deps);
      }
    }

    for (const summary of await listArchive()) {
      const entry = await getArchiveEntry(summary.id);
      if (!entry) continue;
      for (const message of entry.messages) {
        if (message.id in index) continue;
        await indexMessageForMemory(message, entry.chat.title, deps);
      }
    }
  } catch (err) {
    console.error(`[emmy-memory] reconciliation failed: ${(err as Error).message}`);
  }
}
