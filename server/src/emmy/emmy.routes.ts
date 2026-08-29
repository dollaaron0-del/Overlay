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
import { publishEmmyMessage, publishEmmyChats, publishEmmyTopicWindows } from "./emmy-bus.js";
import {
  listTopicWindows,
  createTopicWindow,
  patchTopicWindow,
  deleteTopicWindow,
} from "./topic-window-store.js";
import { listActivities, markWorking, markIdle } from "./emmy-activity.js";
import { classifyTask, DEFAULT_INTERVAL_HOURS, DEFAULT_RESEARCH_WINDOW_HOURS } from "./emmy-categorize.js";
import type { EmmyCategory, EmmyChat, EmmyMessage, EmmyResearchPhase } from "@overlay/shared";
import { sendEmmyHookTurn } from "../openclaw/openclaw-webhook.js";
import { saveEmmyAttachments, attachmentsDir } from "./emmy-attachments.js";
import { resolveSafePath, UnsafePathError } from "../files/safe-path.js";
import { indexMessageForMemory, retrieveMemory, purgeMessagesFromMemory } from "./emmy-memory.js";
import { buildEmmyTurnMessage, sessionKeyFor, turnModelFor } from "./emmy-turn-message.js";
import { resetGeneralChat } from "./emmy-conversation-reset.js";

// CRUD + reads (normal JSON body limit, mounted under protectedApi).
export const emmyRouter = Router();

// Message send + attachment download (its own larger JSON body limit, mounted
// earlier in server.ts at /api/emmy/chats — base64 attachments run ~33%
// bigger than the raw file, same split ideachat uses).
export const emmySendRouter = Router();

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

// ---- topic windows --------------------------------------------------------
// Free-floating reference windows on the home screen. Persisted so they
// survive reloads; the /ws/emmy socket pushes the whole list on any change.

async function broadcastTopicWindows(): Promise<void> {
  publishEmmyTopicWindows(await listTopicWindows());
}

const topicWindowCreateSchema = z.object({
  title: z.string().max(200),
  content: z.string(),
  x: z.number().optional(),
  y: z.number().optional(),
  w: z.number().optional(),
  h: z.number().optional(),
});

const topicWindowPatchSchema = z.object({
  title: z.string().max(200).optional(),
  content: z.string().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  w: z.number().optional(),
  h: z.number().optional(),
  minimized: z.boolean().optional(),
});

emmyRouter.get("/topic-windows", async (_req, res) => {
  res.json(await listTopicWindows());
});

emmyRouter.post("/topic-windows", async (req, res) => {
  const parsed = topicWindowCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", details: parsed.error.issues });
    return;
  }
  const win = await createTopicWindow(parsed.data);
  await broadcastTopicWindows();
  res.status(201).json(win);
});

emmyRouter.patch("/topic-windows/:id", async (req, res) => {
  const parsed = topicWindowPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", details: parsed.error.issues });
    return;
  }
  const win = await patchTopicWindow(req.params.id, parsed.data);
  if (!win) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  await broadcastTopicWindows();
  res.json(win);
});

emmyRouter.delete("/topic-windows/:id", async (req, res) => {
  const ok = await deleteTopicWindow(req.params.id);
  if (!ok) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  await broadcastTopicWindows();
  res.status(204).end();
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
  await purgeMessagesFromMemory(entry.messages.map((m) => m.id));
  res.json({ ok: true });
});

// ---- send a message (with optional attachments) -----------------------------

/** Best-effort short sidebar label from a free-text research request. */
function deriveResearchTaskTitle(text: string): string {
  const cleaned = text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(hey |hi |hallo )?emmy[,:]?\s+/i, "")
    .replace(/^(kannst du|könntest du|koenntest du|würdest du|wuerdest du|mach mal|mach|bitte)\s+/i, "")
    .replace(/^(bitte|mal)\s+/i, "");
  const firstClause = cleaned.split(/(?<=[.!?])\s|\s[–—-]\s|\b(?:in ?dem|und dann|damit wir|sodass|so dass)\b/i)[0] || cleaned;
  const clipped = firstClause.length > 64 ? `${firstClause.slice(0, 61).trimEnd()}…` : firstClause;
  return clipped.charAt(0).toUpperCase() + clipped.slice(1) || "Recherche";
}

/**
 * Turns a research request typed into a non-research chat into its own task
 * chat: seeds it with Aaron's message, hands the origin chat's recent history
 * to the turn for context ("recherchier das mal" only makes sense with the
 * conversation it followed), kicks off the research turn in the new chat's
 * isolated session, and drops a pointer message into the origin chat.
 * Returns the message as stored in the origin chat (what the POST responds
 * with), or null if the hand-off to OpenClaw failed.
 */
async function spinOffResearchTask(
  origin: EmmyChat,
  text: string,
  originHistory: EmmyMessage[],
): Promise<EmmyMessage | null> {
  const cls = classifyTask(text);
  const title = deriveResearchTaskTitle(text);
  const task = await createChat("task", title, { ...cls, categorySource: "auto" });

  const inOrigin = await appendMessage(origin.id, "me", text);
  publishEmmyMessage(inOrigin);
  const seed = await appendMessage(task.id, "me", text);
  publishEmmyMessage(seed);

  const dueLabel = cls.dueAt
    ? new Date(cls.dueAt).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" })
    : null;
  const spinoffNote = `Recherche-Aufgabe „${title}“ läuft in der Seitenleiste${
    dueLabel ? ` (Zeitfenster bis ${dueLabel})` : ""
  }.`;
  // In the general chat the pointer note would just be wiped by the reset
  // below, which seeds its own line — so only post it in a task chat origin.
  const isGeneralOrigin = origin.id === GENERAL_CHAT_ID;
  if (!isGeneralOrigin) {
    const note = await appendMessage(
      origin.id,
      "emmy",
      `Das läuft ab jetzt als eigene Recherche-Aufgabe „${title}“ in der Seitenleiste${
        dueLabel ? ` (Zeitfenster bis ${dueLabel})` : ""
      } — dort siehst du den Fortschritt, und Nachrichten hier unterbrechen sie nicht.`,
    );
    publishEmmyMessage(note);
  }
  await broadcastChats();
  void indexMessageForMemory(inOrigin, origin.title).catch(() => {});
  void indexMessageForMemory(seed, task.title).catch(() => {});

  // Aaron's model: a research spin-off ends the main conversation. Distil it
  // to memory, archive the transcript, blank the chat (see emmy-conversation-reset).
  if (isGeneralOrigin) {
    await resetGeneralChat("spinoff", spinoffNote).catch((err) => {
      console.error(`[emmy] general-chat reset after spin-off failed: ${(err as Error).message}`);
    });
  }

  const context = originHistory.slice(-config.EMMY_MEMORY_RECENT_MESSAGES);
  const memoryHits = await retrieveMemory(text, new Set(context.map((m) => m.id)));
  const prompt = buildEmmyTurnMessage(task.title, "task", task.id, text, context, cls.category, undefined, {
    memoryHits,
    dueAt: cls.dueAt,
  });
  markWorking(task.id, undefined, undefined, cls.category);
  try {
    await sendEmmyHookTurn(
      sessionKeyFor(task.id),
      `Overlay-Aufgabe: ${task.title}`,
      prompt,
      turnModelFor(cls.category, undefined),
    );
  } catch {
    markIdle(task.id);
    return null;
  }
  // Turn is out — persist the "running" flag so the sidebar keeps the row
  // across an Overlay restart / the gap before the first progress ping.
  // Cleared when the summary lands (emmy-inbound.routes.ts).
  await updateChat(task.id, { status: "in_progress" });
  await broadcastChats();
  return inOrigin;
}

const sendSchema = z.object({
  text: z.string().max(8_000).optional(),
  /** Set by the "Abschlussdokument erstellen" button — asks for a final, comprehensive write-up instead of a normal reply. */
  requestFinalDocument: z.boolean().optional(),
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

  // "/neu" (or /new, /reset): deliberately end the main conversation — digest
  // it to memory, archive the transcript, start blank. The command itself is
  // never stored as a message. Only meaningful for the general chat; a task
  // chat *is* its task, so there it just answers with a hint.
  if (/^\/(neu|new|reset)$/i.test(text) && attachmentInputs.length === 0) {
    if (chat.kind !== "general") {
      const hint = await appendMessage(chat.id, "emmy", "„/neu“ leert nur den Allgemein-Chat.");
      publishEmmyMessage(hint);
      res.status(200).json({ ok: true, cleared: false });
      return;
    }
    const result = await resetGeneralChat("command");
    res.status(200).json({ ok: true, cleared: result.cleared, messageCount: result.messageCount });
    return;
  }

  let saved: Awaited<ReturnType<typeof saveEmmyAttachments>>;
  try {
    saved = await saveEmmyAttachments(chat.id, attachmentInputs);
  } catch (err) {
    res.status(400).json({ error: "attachment_failed", message: (err as Error).message });
    return;
  }

  // Fetched once, before this turn's own message exists yet, and reused for
  // both the classifier below and the recent-history/memory-exclusion context
  // further down — otherwise the tier-1 window would include the message
  // currently being sent.
  const priorMessages = await listMessages(chat.id);

  // The title alone is often too terse to classify well ("Server"), so the
  // first message re-decides — but never against a category Aaron pinned.
  const isFirstMessage = priorMessages.length === 0;
  let category = chat.category;
  const freshTaskClassify = chat.kind === "task" && isFirstMessage && chat.categorySource !== "manual" && !!text;
  if (freshTaskClassify) {
    const classification = classifyTask(`${chat.title}\n${text}`);
    await updateChat(chat.id, { ...classification, categorySource: "auto" });
    category = classification.category;
  }

  // A deep-research request typed *outside* a fresh research task — in the
  // general chat, or as a follow-up in an instant/recurring chat or a
  // research chat that has already moved on to discussion — is spun off into
  // its own task chat. That puts it in the sidebar with a deadline and, just
  // as importantly, runs it in an isolated agent session so later chatter in
  // this chat can no longer abort the hours-long research turn (which is what
  // silently killed the run on 2026-08-28). Skipped when the message carries
  // attachments (they live under this chat's id and would 404 from a new one)
  // and when the fresh-task classifier above already handled it.
  const activeResearchHere =
    chat.kind === "task" && chat.category === "research" && chat.researchPhase !== "discussion";
  if (
    text &&
    attachmentInputs.length === 0 &&
    !freshTaskClassify &&
    !activeResearchHere &&
    classifyTask(text).category === "research"
  ) {
    const inOrigin = await spinOffResearchTask(chat, text, priorMessages);
    if (!inOrigin) {
      res.status(502).json({ error: "openclaw_send_failed", message: "Recherche-Aufgabe konnte nicht gestartet werden" });
      return;
    }
    res.status(201).json(inOrigin);
    return;
  }

  const recentMessages = priorMessages.slice(-config.EMMY_MEMORY_RECENT_MESSAGES);
  const memoryHits = await retrieveMemory(text, new Set(recentMessages.map((m) => m.id)));

  // Saved + broadcast before the outbound turn is even attempted — a failed
  // hand-off to OpenClaw must not make the message vanish from the chat; it
  // just shows as "not delivered".
  const displayText = text || (saved.length === 1 ? saved[0].originalName : `${saved.length} Dateien`);
  const message = await appendMessage(chat.id, "me", displayText, saved);
  publishEmmyMessage(message);
  await broadcastChats();
  // Best-effort and unawaited: a slow/absent Ollama must never delay this
  // response, and this message doesn't need to retrieve itself.
  void indexMessageForMemory(message, chat.title).catch(() => {});

  const attachmentPaths = saved.map((a) => ({
    abs: path.resolve(attachmentsDir(chat.id), a.filename),
    name: a.originalName,
  }));
  const requestFinalDocument = parsed.data.requestFinalDocument === true;
  const prompt = buildEmmyTurnMessage(chat.title, chat.kind, chat.id, text, recentMessages, category, chat.researchPhase, {
    attachmentPaths,
    memoryHits,
    requestFinalDocument,
    dueAt: chat.dueAt,
  });
  const name = chat.kind === "task" ? `Overlay-Aufgabe: ${chat.title}` : "Overlay-Chat";

  // Remembered so the inbound reply that eventually lands can be tagged as
  // the final document — the outbound prompt alone doesn't survive the round
  // trip through the external agent turn.
  if (requestFinalDocument) {
    await updateChat(chat.id, { pendingFinalDocument: true });
  }

  // SOFORT PING: UI sieht jetzt sofort „arbeitet daran"
  markWorking(chat.id, undefined, undefined, category);

  try {
    await sendEmmyHookTurn(sessionKeyFor(chat.id), name, prompt, turnModelFor(category, chat.researchPhase));
  } catch (err) {
    // Nur bei echtem Fehler wieder auf „idle" setzen
    markIdle(chat.id);
    // The turn never made it out, so no reply will land on /api/emmy/inbound
    // to consume this flag — leaving it set would wrongly tag the next
    // unrelated reply as the final document.
    if (requestFinalDocument) await updateChat(chat.id, { pendingFinalDocument: false });
    res.status(502).json({ error: "openclaw_send_failed", message: (err as Error).message, saved: message });
    return;
  }

  // Turn is out: a research task whose gathering phase is still open now
  // counts as "running" for the sidebar — persisted so the row survives an
  // Overlay restart and the gap before the first progress ping. Cleared when
  // the summary lands (emmy-inbound.routes.ts) or Aaron marks it done.
  if (
    chat.kind === "task" &&
    category === "research" &&
    chat.researchPhase !== "discussion" &&
    chat.status !== "in_progress"
  ) {
    await updateChat(chat.id, { status: "in_progress" });
    await broadcastChats();
  }

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
