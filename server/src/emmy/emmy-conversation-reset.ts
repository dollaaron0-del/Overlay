import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  GENERAL_CHAT_ID,
  listChats,
  listMessages,
  deleteChat,
  appendMessage,
} from "./emmy-store.js";
import { publishEmmyMessage, publishEmmyChats, publishEmmyChatCleared } from "./emmy-bus.js";
import { indexTextForMemory } from "./emmy-memory.js";

// One file per reset, dropped here for the workspace-side sync (a cron as the
// aaron user folds these into ~/.openclaw/workspace/memory/ — the same memory
// as the direct chats). aaron has an rwx ACL on data/, so it can read them.
const DIGEST_DROP_DIR = path.join(process.cwd(), "data", "general-chat-digests");

async function dropDigestFile(digest: string): Promise<void> {
  try {
    await fs.mkdir(DIGEST_DROP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(DIGEST_DROP_DIR, `${stamp}-${crypto.randomUUID().slice(0, 8)}.md`);
    await fs.writeFile(file, `${digest}\n`, "utf8");
  } catch (err) {
    console.error(`[emmy] digest drop-file write failed: ${(err as Error).message}`);
  }
}

// Resetting the general chat: Aaron wants the main conversation to be
// disposable — when a research/check spins off from it, or he types /neu, it
// should go blank and start fresh. What was said still matters though, so
// before blanking we distil the thread into one memory entry (retrievable by
// later turns via emmy-memory) and archive the verbatim history (deleteChat
// already does that for the general chat). Task chats are never reset this
// way — they *are* the task.

const DIGEST_LINE_MAX = 320;
const DIGEST_MAX_MESSAGES = 60;

function firstLine(text: string, max: number): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Builds the distilled "what was this about" text stored in long-term memory. */
export function buildConversationDigest(
  messages: { role: "me" | "emmy"; text: string; at: string }[],
): string {
  const kept = messages.filter((m) => m.text.trim().length > 0);
  if (kept.length === 0) return "";
  const from = formatDay(kept[0].at);
  const to = formatDay(kept[kept.length - 1].at);
  const span = from === to ? from : `${from}–${to}`;

  const trimmed = kept.slice(-DIGEST_MAX_MESSAGES);
  const aaron = trimmed.filter((m) => m.role === "me").map((m) => `- ${firstLine(m.text, DIGEST_LINE_MAX)}`);
  const emmy = trimmed.filter((m) => m.role === "emmy").map((m) => `- ${firstLine(m.text, DIGEST_LINE_MAX)}`);

  const parts = [
    `Frühere Unterhaltung im Allgemein-Chat (${span}, ${kept.length} Nachrichten).`,
    ``,
    `Was Aaron gesagt/gefragt hat:`,
    ...(aaron.length > 0 ? aaron : ["- (nichts)"]),
  ];
  if (emmy.length > 0) {
    parts.push(``, `Wie Emmy geantwortet hat (Kurzfassung):`, ...emmy);
  }
  return parts.join("\n");
}

export interface ResetResult {
  cleared: boolean;
  messageCount: number;
  digestStored: boolean;
}

/**
 * Archives + blanks the general chat, after writing a digest of it to memory.
 * Safe to call when the chat is already empty (returns cleared:false). Seeds
 * the fresh chat with one short "kept it in mind" line so the reset is visible
 * and reassuring rather than a silent wipe.
 */
export async function resetGeneralChat(
  reason: "spinoff" | "command",
  spinoffNote?: string,
): Promise<ResetResult> {
  const messages = await listMessages(GENERAL_CHAT_ID);
  const content = messages.filter((m) => m.text.trim().length > 0);
  if (content.length === 0) {
    return { cleared: false, messageCount: 0, digestStored: false };
  }

  const digest = buildConversationDigest(
    content.map((m) => ({ role: m.role, text: m.text, at: m.at })),
  );
  const digestStored = digest
    ? await indexTextForMemory(
        `digest:${crypto.randomUUID()}`,
        digest,
        "Frühere Unterhaltung (Gedächtnisnotiz)",
        new Date().toISOString(),
      )
    : false;
  if (digest) await dropDigestFile(digest);

  const from = formatDay(content[0].at);
  const to = formatDay(content[content.length - 1].at);
  const span = from === to ? from : `${from}–${to}`;

  // Archives the verbatim history and leaves the general chat present but empty.
  await deleteChat(GENERAL_CHAT_ID);
  publishEmmyChatCleared(GENERAL_CHAT_ID);

  const lead = spinoffNote ? `${spinoffNote.trim()} ` : reason === "spinoff" ? "Das läuft jetzt als eigene Aufgabe. " : "";
  const seedText =
    `${lead}Die vorherige Unterhaltung (${span}, ${content.length} Nachrichten) ist ` +
    `${digestStored ? "in meinem Langzeitgedächtnis" : "im Archiv"} — hier fangen wir frisch an.`;
  const seed = await appendMessage(GENERAL_CHAT_ID, "emmy", seedText);
  publishEmmyMessage(seed);
  publishEmmyChats(await listChats());

  return { cleared: true, messageCount: content.length, digestStored };
}
