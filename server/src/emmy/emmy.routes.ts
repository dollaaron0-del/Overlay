import { Router } from "express";
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import {
  listChats,
  getChat,
  createChat,
  updateChat,
  deleteChat,
  listMessages,
  appendMessage,
  listArchive,
  getArchiveEntry,
  listArchivedMessages,
  purgeArchiveEntry,
  GENERAL_CHAT_ID,
} from "./emmy-store.js";
import { publishEmmyMessage, publishEmmyChats } from "./emmy-bus.js";
import { listActivities, markWorking, markIdle } from "./emmy-activity.js";
import { classifyTask, DEFAULT_INTERVAL_HOURS, DEFAULT_RESEARCH_WINDOW_HOURS } from "./emmy-categorize.js";
import type { EmmyCategory, EmmyChat } from "@overlay/shared";
import { sendEmmyHookTurn } from "../openclaw/openclaw-webhook.js";
import { saveEmmyAttachments, attachmentsDir } from "./emmy-attachments.js";
import { resolveSafePath, UnsafePathError } from "../files/safe-path.js";

// CRUD + reads (normal JSON body limit, mounted under protectedApi).
export const emmyRouter = Router();

// Message send + attachment download (its own larger JSON body limit, mounted
// earlier in server.ts at /api/emmy/chats — base64 attachments run ~33%
// bigger than the raw file, same split ideachat uses).
export const emmySendRouter = Router();

function sessionKeyFor(chatId: string): string {
  return `agent:main:overlay:${chatId}`;
}

async function broadcastChats(): Promise<void> {
  publishEmmyChats(await listChats());
}

// ---- reads + CRUD -----------------------------------------------------------

emmyRouter.get("/chats", async (_req, res) => {
  res.json(await listChats());
});

emmyRouter.get("/chats/:id/messages", async (req, res) => {
  const chat = await getChat(req.params.id);
  if (!chat) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json(await listMessages(req.params.id));
});

/** What Emmy is busy with right now; the same list the /ws/emmy socket pushes. */
emmyRouter.get("/activity", (_req, res) => {
  res.json(listActivities());
});

const createSchema = z.object({
  kind: z.enum(["general", "task"]).default("task"),
  title: z.string().max(200).optional(),
});

emmyRouter.post("/chats", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", details: parsed.error.issues });
    return;
  }
  const title = parsed.data.title ?? "Neue Aufgabe";
  // First guess from the title alone; refined once the first message arrives.
  const classification =
    parsed.data.kind === "task" ? { ...classifyTask(title), categorySource: "auto" as const } : undefined;
  const chat = await createChat(parsed.data.kind, title, classification);
  await broadcastChats();
  res.status(201).json(chat);
});

/**
 * The schedule fields that go with an explicitly picked category. Explicit
 * values in the same request always win; `null` means "clear this field".
 */
function defaultsForCategory(
  category: EmmyCategory | undefined,
  existing: EmmyChat | undefined,
  dueAt: string | null | undefined,
  intervalHours: number | null | undefined,
): { dueAt?: string | null; intervalHours?: number | null } {
  if (category === undefined) return { dueAt, intervalHours };
  if (category === "research") {
    return {
      dueAt: dueAt ?? existing?.dueAt ?? new Date(Date.now() + DEFAULT_RESEARCH_WINDOW_HOURS * 3_600_000).toISOString(),
      intervalHours: null,
    };
  }
  if (category === "recurring") {
    return { dueAt: null, intervalHours: intervalHours ?? existing?.intervalHours ?? DEFAULT_INTERVAL_HOURS };
  }
  return { dueAt: null, intervalHours: null };
}

const patchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  status: z.enum(["open", "in_progress", "done"]).optional(),
  category: z.enum(["instant", "research", "recurring"]).optional(),
  dueAt: z.string().datetime().nullable().optional(),
  intervalHours: z.number().positive().max(24 * 365).nullable().optional(),
});

emmyRouter.patch("/chats/:id", async (req, res) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", details: parsed.error.issues });
    return;
  }
  const { category, dueAt, intervalHours, ...rest } = parsed.data;
  const existing = await getChat(req.params.id);
  // Categories describe tasks; the general chat never carries one.
  const isTask = existing?.kind === "task";
  const updated = await updateChat(req.params.id, {
    ...rest,
    // A hand-picked category is final: it pins categorySource so neither the
    // classifier nor Emmy re-guesses it later.
    ...(isTask && category !== undefined ? { category, categorySource: "manual" as const } : {}),
    // Each category is defined by its schedule field, so switching into one
    // fills the missing field with a default and switching out drops both —
    // a "sofort" task must not keep a stale deadline lying around.
    ...(isTask ? defaultsForCategory(category, existing, dueAt, intervalHours) : {}),
  });
  if (!updated) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  await broadcastChats();
  res.json(updated);
});

/**
 * Clears a conversation. Task chats leave the list, the general chat is
 * emptied and stays — either way the history moves to the archive rather than
 * being destroyed (see deleteChat), and the attachment files stay on disk
 * because the archived messages still point at them.
 */
emmyRouter.delete("/chats/:id", async (req, res) => {
  const ok = await deleteChat(req.params.id);
  if (!ok) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  markIdle(req.params.id);
  await broadcastChats();
  res.json({ ok: true, archived: true, cleared: req.params.id === GENERAL_CHAT_ID });
});

// ---- archive ----------------------------------------------------------------

emmyRouter.get("/archive", async (_req, res) => {
  res.json(await listArchive());
});

emmyRouter.get("/archive/:id", async (req, res) => {
  const entry = await getArchiveEntry(req.params.id);
  if (!entry) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json(entry);
});

/** The only way to really lose a conversation — takes its attachment files with it. */
emmyRouter.delete("/archive/:id", async (req, res) => {
  const entry = await getArchiveEntry(req.params.id);
  if (!entry) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  await purgeArchiveEntry(req.params.id);
  // Only this entry's own files: the directory is shared with the live chat of
  // the same id (and with other archived entries of it), so it must survive.
  const dir = attachmentsDir(entry.chat.id);
  for (const attachment of entry.messages.flatMap((m) => m.attachments ?? [])) {
    await fs.rm(path.join(dir, attachment.filename), { force: true }).catch(() => {});
  }
  res.json({ ok: true });
});

// ---- send a message (with optional attachments) -----------------------------

const sendSchema = z.object({
  text: z.string().max(8_000).optional(),
  attachments: z
    .array(
      z.object({
        dataBase64: z.string().min(1),
        mimeType: z.string().min(1),
        originalName: z.string().min(1).max(255),
      }),
    )
    .max(10)
    .optional(),
});

/**
 * Builds the prompt for the isolated agent turn. It carries everything the
 * turn needs to answer AND to post its reply back into the right chat — the
 * inbound token is included here because the agent process runs as `aaron`,
 * which cannot read Overlay's root-owned .env itself.
 */
function buildPrompt(
  chatTitle: string,
  chatKind: string,
  chatId: string,
  userText: string,
  attachmentPaths: { abs: string; name: string }[],
): string {
  const lines: string[] = [];
  const context = chatKind === "task" ? `zur Aufgabe „${chatTitle}"` : "im allgemeinen Chat";
  lines.push(`[Overlay] Nachricht von Aaron ${context}:`);
  lines.push("");
  lines.push(userText || "(keine Textnachricht, siehe Anhänge)");
  if (attachmentPaths.length > 0) {
    lines.push("");
    lines.push("Angehängte Dateien (mit deinen Tools direkt lesbar):");
    for (const a of attachmentPaths) lines.push(`- ${a.abs}  („${a.name}")`);
  }
  lines.push("");
  lines.push("--- So antwortest du ---");
  lines.push(
    `Beantworte das als Emmy auf Deutsch. Deine Antwort erscheint NUR dann im Overlay-Chat, wenn du sie an diesen Endpunkt zurückschickst (genau ein POST):`,
  );
  lines.push(`  URL:    http://127.0.0.1:${config.PORT}/api/emmy/inbound`);
  lines.push(`  Header: Authorization: Bearer ${config.EMMY_INBOUND_TOKEN}`);
  lines.push(`  Body:   JSON {"chatId":"${chatId}","text":"<deine vollständige Antwort>"}`);
  lines.push(
    `Tipp: Schreib die JSON-Payload in eine temporäre Datei und sende sie mit "curl --data @datei", um Quoting-Probleme zu vermeiden. Sende deine Antwort nur einmal.`,
  );
  lines.push("");
  lines.push("--- Zwischenstand (optional, aber erwünscht) ---");
  lines.push(
    `Solange du arbeitest, sieht Aaron im Chat nur „arbeitet daran". Sag ihm in einem Satz, woran gerade — an denselben Endpunkt, ohne "text", beliebig oft:`,
  );
  lines.push(`  Body:   JSON {"chatId":"${chatId}","activity":"<woran du gerade arbeitest>"}`);
  lines.push(`Sobald du die eigentliche Antwort mit "text" schickst, verschwindet der Hinweis von selbst.`);
  if (chatKind === "task") {
    lines.push("");
    lines.push("--- Einordnung (optional) ---");
    lines.push(
      `Overlay sortiert jede Aufgabe automatisch in eine von drei Kategorien. Liegt sie falsch, korrigier sie im selben POST:`,
    );
    lines.push(`  "category":"instant"   — sofort erledigen`);
    lines.push(`  "category":"research"  — tiefere Recherche, dazu "dueAt":"<ISO-Zeitpunkt>" als Ende des Zeitfensters`);
    lines.push(`  "category":"recurring" — wiederkehrender Check, dazu "intervalHours":<Zahl>`);
    lines.push(`Hat Aaron die Kategorie selbst gesetzt, wird deine Korrektur ignoriert — das ist so gewollt.`);
  }
  return lines.join("\n");
}

emmySendRouter.post("/:id/messages", async (req, res) => {
  const parsed = sendSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", details: parsed.error.issues });
    return;
  }
  const text = (parsed.data.text ?? "").trim();
  const attachmentInputs = parsed.data.attachments ?? [];
  if (!text && attachmentInputs.length === 0) {
    res.status(400).json({ error: "empty_message" });
    return;
  }

  const chat = await getChat(req.params.id);
  if (!chat) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  let saved: Awaited<ReturnType<typeof saveEmmyAttachments>>;
  try {
    saved = await saveEmmyAttachments(chat.id, attachmentInputs);
  } catch (err) {
    res.status(400).json({ error: "attachment_failed", message: (err as Error).message });
    return;
  }

  // The title alone is often too terse to classify well ("Server"), so the
  // first message re-decides — but never against a category Aaron pinned.
  const isFirstMessage = (await listMessages(chat.id)).length === 0;
  if (chat.kind === "task" && isFirstMessage && chat.categorySource !== "manual" && text) {
    await updateChat(chat.id, { ...classifyTask(`${chat.title}\n${text}`), categorySource: "auto" });
  }

  // Saved + broadcast before the outbound turn is even attempted — a failed
  // hand-off to OpenClaw must not make the message vanish from the chat; it
  // just shows as "not delivered".
  const displayText = text || (saved.length === 1 ? saved[0].originalName : `${saved.length} Dateien`);
  const message = await appendMessage(chat.id, "me", displayText, saved);
  publishEmmyMessage(message);
  await broadcastChats();

  const attachmentPaths = saved.map((a) => ({
    abs: path.resolve(attachmentsDir(chat.id), a.filename),
    name: a.originalName,
  }));
  const prompt = buildPrompt(chat.title, chat.kind, chat.id, text, attachmentPaths);
  const name = chat.kind === "task" ? `Overlay-Aufgabe: ${chat.title}` : "Overlay-Chat";

  try {
    await sendEmmyHookTurn(sessionKeyFor(chat.id), name, prompt);
  } catch (err) {
    // Nothing is running on the other side, so the chat must not claim she's on it.
    markIdle(chat.id);
    res.status(502).json({ error: "openclaw_send_failed", message: (err as Error).message, saved: message });
    return;
  }

  // The turn was accepted; from here the chat shows "arbeitet daran" until her
  // reply lands on /api/emmy/inbound (or the note goes stale).
  markWorking(chat.id);
  res.status(201).json(message);
});

// ---- attachment download ----------------------------------------------------

emmySendRouter.get("/:id/attachments/:filename", async (req, res) => {
  // Archived messages count too: clearing a chat keeps its history readable,
  // and a history with dead image links would not be kept, only listed.
  const messages = [...(await listMessages(req.params.id)), ...(await listArchivedMessages(req.params.id))];
  // Only ever serves a filename already recorded on this chat (server-
  // generated in saveEmmyAttachments), so the URL segment can't request an
  // arbitrary path even before resolveSafePath re-checks it.
  const attachment = messages.flatMap((m) => m.attachments ?? []).find((a) => a.filename === req.params.filename);
  if (!attachment) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  try {
    const target = await resolveSafePath(attachmentsDir(req.params.id), attachment.filename);
    res.type(attachment.mimeType);
    res.sendFile(target);
  } catch (err) {
    if (err instanceof UnsafePathError) {
      res.status(400).json({ error: "unsafe_path" });
      return;
    }
    res.status(404).json({ error: "not_found" });
  }
});
