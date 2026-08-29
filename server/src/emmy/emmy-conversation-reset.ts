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
import { config } from "../config.js";
import { generateOllamaCompletion } from "../security/ollama-client.js";

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

// The prose digest: same job as buildConversationDigest, but a local model
// writes it as a short paragraph in Emmy's voice instead of a mechanical
// bullet list. Kept deliberately close to the rest of emmy-memory's Ollama
// use — best-effort, never throws, and the caller always has the mechanical
// digest to fall back to, so a slow/unreachable Ollama or a garbage
// completion just means the old behaviour, never a lost memory.

const PROSE_TRANSCRIPT_LINE_MAX = 600;
const PROSE_TRANSCRIPT_MAX_MESSAGES = 80;
const PROSE_MIN_CHARS = 40;
const PROSE_MAX_CHARS = 1500;

/** Ollama /api/generate call, injectable so the prompt shaping can be unit-tested without a model. */
export type ProseGenerator = (
  baseUrl: string,
  model: string,
  prompt: string,
  timeoutMs: number,
) => Promise<string>;

export function buildProseDigestPrompt(
  messages: { role: "me" | "emmy"; text: string; at: string }[],
): string {
  const kept = messages.filter((m) => m.text.trim().length > 0).slice(-PROSE_TRANSCRIPT_MAX_MESSAGES);
  const transcript = kept
    .map((m) => `${m.role === "me" ? "Aaron" : "Emmy"}: ${firstLine(m.text, PROSE_TRANSCRIPT_LINE_MAX)}`)
    .join("\n");
  return [
    "Du bist Emmy. Fasse die folgende Unterhaltung mit Aaron für dein eigenes",
    "Langzeitgedächtnis zusammen — so, dass du später weißt, worum es ging,",
    "was entschieden wurde und was noch offen ist.",
    "",
    "Regeln:",
    "- Deutsch, 3–7 Sätze, ein zusammenhängender Absatz, keine Aufzählungspunkte.",
    "- Nüchtern und konkret: Themen, Entscheidungen, offene Fäden, zugesagte",
    "  nächste Schritte. Keine Höflichkeitsfloskeln, keine Einleitung wie",
    '  "In dieser Unterhaltung…".',
    "- Nur was wirklich gesagt wurde. Nichts dazuerfinden.",
    "",
    "Unterhaltung:",
    transcript,
    "",
    "Zusammenfassung:",
  ].join("\n");
}

/**
 * Returns a prose digest, or null to signal "use the mechanical one" — when
 * the model is unset, the conversation is empty, Ollama fails, or the model
 * gives back something too short or implausibly long to be a real summary.
 * The model id is passed in (not read from config here) so the shaping stays
 * unit-testable without touching the config singleton.
 */
export async function buildProseDigest(
  messages: { role: "me" | "emmy"; text: string; at: string }[],
  model: string,
  generate: ProseGenerator = generateOllamaCompletion,
): Promise<string | null> {
  if (!model) return null;
  if (messages.filter((m) => m.text.trim().length > 0).length === 0) return null;
  try {
    const raw = await generate(
      config.EMMY_MEMORY_OLLAMA_URL,
      model,
      buildProseDigestPrompt(messages),
      config.EMMY_MEMORY_DIGEST_TIMEOUT_MS,
    );
    const prose = raw.trim();
    if (prose.length < PROSE_MIN_CHARS || prose.length > PROSE_MAX_CHARS) return null;
    return prose;
  } catch (err) {
    console.error(`[emmy] prose digest failed, falling back to mechanical: ${(err as Error).message}`);
    return null;
  }
}

export interface ResetResult {
  cleared: boolean;
  messageCount: number;
  digestStored: boolean;
  /** true if the stored digest was model-written prose, false if the mechanical fallback. */
  digestProse: boolean;
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
    return { cleared: false, messageCount: 0, digestStored: false, digestProse: false };
  }

  const shaped = content.map((m) => ({ role: m.role, text: m.text, at: m.at }));
  const from = formatDay(content[0].at);
  const to = formatDay(content[content.length - 1].at);
  const span = from === to ? from : `${from}–${to}`;

  // Prefer a model-written prose summary; fall back to the mechanical digest
  // whenever that isn't available. Either way the digest opens with the same
  // dated header line so cross-chat retrieval keeps the "when / how much"
  // metadata regardless of which path produced the body.
  const prose = await buildProseDigest(shaped, config.EMMY_MEMORY_DIGEST_MODEL);
  const digest = prose
    ? `Frühere Unterhaltung im Allgemein-Chat (${span}, ${content.length} Nachrichten).\n\n${prose}`
    : buildConversationDigest(shaped);
  const digestProse = prose !== null;

  const digestStored = digest
    ? await indexTextForMemory(
        `digest:${crypto.randomUUID()}`,
        digest,
        "Frühere Unterhaltung (Gedächtnisnotiz)",
        new Date().toISOString(),
      )
    : false;
  if (digest) await dropDigestFile(digest);

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

  return { cleared: true, messageCount: content.length, digestStored, digestProse };
}
