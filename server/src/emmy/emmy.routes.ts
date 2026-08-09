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
  GENERAL_CHAT_ID,
} from "./emmy-store.js";
import { publishEmmyMessage, publishEmmyChats } from "./emmy-bus.js";
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
  const chat = await createChat(parsed.data.kind, parsed.data.title ?? "Neue Aufgabe");
  await broadcastChats();
  res.status(201).json(chat);
});

const patchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  status: z.enum(["open", "in_progress", "done"]).optional(),
});

emmyRouter.patch("/chats/:id", async (req, res) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", details: parsed.error.issues });
    return;
  }
  const updated = await updateChat(req.params.id, parsed.data);
  if (!updated) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  await broadcastChats();
  res.json(updated);
});

emmyRouter.delete("/chats/:id", async (req, res) => {
  const ok = await deleteChat(req.params.id);
  if (!ok) {
    // Either it doesn't exist or it's the undeletable general chat.
    res.status(req.params.id === GENERAL_CHAT_ID ? 400 : 404).json({ error: "not_deletable" });
    return;
  }
  // Best-effort: drop the chat's attachment directory too; a leftover folder
  // must never fail the delete the user asked for.
  await fs.rm(attachmentsDir(req.params.id), { recursive: true, force: true }).catch(() => {});
  await broadcastChats();
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
    res.status(502).json({ error: "openclaw_send_failed", message: (err as Error).message, saved: message });
    return;
  }

  res.status(201).json(message);
});

// ---- attachment download ----------------------------------------------------

emmySendRouter.get("/:id/attachments/:filename", async (req, res) => {
  const messages = await listMessages(req.params.id);
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
