import { Router } from "express";
import { z } from "zod";
import { getProject, resolveProjectDir } from "../projects/projects.registry.js";
import { listIdeaChats, getIdeaChat, createIdeaChat, appendIdeaChatMessages } from "./ideachat-store.js";
import { answerIdeaChatMessage } from "./tiered-answer.js";
import { writeIdeaPlan } from "./plan-writer.js";
import { getAiCascadeStatus } from "./ai-status.js";
import { appendAuditEntry } from "../audit/audit-log.js";
import { notifyOpenClawIfConfigured } from "../openclaw/openclaw-webhook.js";
import { saveIdeaChatAttachments, attachmentsDir } from "./ideachat-attachments.js";
import { resolveSafePath, UnsafePathError } from "../files/safe-path.js";

export const ideaChatRouter = Router();

/**
 * Separate router for attachment upload/download, mounted at the same
 * "/api/idea-chats" prefix but earlier in server.ts with its own larger
 * body-size limit — same reasoning as the quick-capture router (base64 JSON
 * runs ~33% bigger than the raw file).
 */
export const ideaChatAttachmentsRouter = Router();

ideaChatRouter.get("/", async (_req, res) => {
  const chats = await listIdeaChats();
  res.json(chats.map(({ id, projectId, title, createdAt, updatedAt }) => ({ id, projectId, title, createdAt, updatedAt })));
});

// Registered before "/:id" — otherwise the param route would swallow this
// path as if "ai-status" were a chat id.
ideaChatRouter.get("/ai-status", async (_req, res) => {
  res.json(await getAiCascadeStatus());
});

ideaChatRouter.get("/:id", async (req, res) => {
  const chat = await getIdeaChat(req.params.id);
  if (!chat) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json(chat);
});

const createSchema = z.object({
  projectId: z.string().min(1),
  message: z.string().min(1).max(20_000),
});

ideaChatRouter.post("/", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", details: parsed.error.issues });
    return;
  }
  const { projectId, message } = parsed.data;
  const project = await getProject(projectId);
  if (!project) {
    res.status(404).json({ error: "project_not_found" });
    return;
  }

  let answer: Awaited<ReturnType<typeof answerIdeaChatMessage>>;
  try {
    answer = await answerIdeaChatMessage([], message, resolveProjectDir(project), null);
  } catch (err) {
    res.status(502).json({ error: "chat_failed", message: (err as Error).message });
    return;
  }

  // Only persisted once the AI call actually succeeded, so a failure never
  // leaves a chat behind with a message nobody answered.
  const chat = await createIdeaChat(projectId, message);
  const updated = await appendIdeaChatMessages(
    chat.id,
    [{ role: "assistant", text: answer.reply, at: new Date().toISOString(), source: answer.source }],
    answer.claudeSessionId,
  );
  res.status(201).json(updated);
});

const messageSchema = z.object({ message: z.string().min(1).max(20_000) });

ideaChatRouter.post("/:id/messages", async (req, res) => {
  const parsed = messageSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", details: parsed.error.issues });
    return;
  }
  const chat = await getIdeaChat(req.params.id);
  if (!chat) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const project = await getProject(chat.projectId);
  if (!project) {
    res.status(400).json({ error: "project_missing" });
    return;
  }

  let answer: Awaited<ReturnType<typeof answerIdeaChatMessage>>;
  try {
    answer = await answerIdeaChatMessage(
      chat.messages,
      parsed.data.message,
      resolveProjectDir(project),
      chat.claudeSessionId,
    );
  } catch (err) {
    res.status(502).json({ error: "chat_failed", message: (err as Error).message });
    return;
  }

  const now = new Date().toISOString();
  const updated = await appendIdeaChatMessages(
    chat.id,
    [
      { role: "user", text: parsed.data.message, at: now },
      { role: "assistant", text: answer.reply, at: new Date().toISOString(), source: answer.source },
    ],
    answer.claudeSessionId,
  );
  res.json(updated);
});

ideaChatRouter.post("/:id/save-plan", async (req, res) => {
  const chat = await getIdeaChat(req.params.id);
  if (!chat) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const project = await getProject(chat.projectId);
  if (!project) {
    res.status(400).json({ error: "project_missing" });
    return;
  }

  try {
    const { filename, relativePath } = await writeIdeaPlan(project, chat);
    await appendAuditEntry({ type: "idea_plan_saved", detail: project.id });
    await notifyOpenClawIfConfigured(`Neuer Ideenplan gespeichert: "${chat.title}" (${project.id}/${relativePath})`);
    res.json({ ok: true, filename, relativePath });
  } catch (err) {
    res.status(400).json({ error: "save_failed", message: (err as Error).message });
  }
});

const attachmentsSchema = z.object({
  message: z.string().max(20_000).optional(),
  attachments: z
    .array(
      z.object({
        dataBase64: z.string().min(1),
        mimeType: z.string().min(1),
        originalName: z.string().min(1).max(255),
      }),
    )
    .min(1)
    .max(10),
});

ideaChatAttachmentsRouter.post("/:id/attachments", async (req, res) => {
  const parsed = attachmentsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", details: parsed.error.issues });
    return;
  }
  const chat = await getIdeaChat(req.params.id);
  if (!chat) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const project = await getProject(chat.projectId);
  if (!project) {
    res.status(400).json({ error: "project_missing" });
    return;
  }

  let saved: Awaited<ReturnType<typeof saveIdeaChatAttachments>>;
  try {
    saved = await saveIdeaChatAttachments(project, chat.id, parsed.data.attachments);
  } catch (err) {
    res.status(400).json({ error: "attachment_failed", message: (err as Error).message });
    return;
  }

  const attachmentList = saved.map((a) => `idea-attachments/${chat.id}/${a.filename} ("${a.originalName}")`).join(", ");
  const userText =
    parsed.data.message?.trim() ||
    (saved.length === 1 ? `Anhang hinzugefügt: ${saved[0].originalName}` : `${saved.length} Anhänge hinzugefügt`);
  // The headless claude turn only has Read/Glob/Grep tools (see ideachat.ts)
  // but no image-reading channel of its own — pointing it at the saved path
  // lets it Read a document/text attachment if relevant; images are mainly
  // for the human to review via the chat UI.
  const messageForAi = `${userText}\n\n[Angehängte Datei(en) liegen im Projekt unter: ${attachmentList}]`;

  let answer: Awaited<ReturnType<typeof answerIdeaChatMessage>>;
  try {
    answer = await answerIdeaChatMessage(chat.messages, messageForAi, resolveProjectDir(project), chat.claudeSessionId);
  } catch (err) {
    res.status(502).json({ error: "chat_failed", message: (err as Error).message });
    return;
  }

  const now = new Date().toISOString();
  const updated = await appendIdeaChatMessages(
    chat.id,
    [
      { role: "user", text: userText, at: now, attachments: saved },
      { role: "assistant", text: answer.reply, at: new Date().toISOString(), source: answer.source },
    ],
    answer.claudeSessionId,
  );
  await appendAuditEntry({ type: "idea_attachment_added", detail: `${project.id}:${saved.length}` });
  res.json(updated);
});

ideaChatAttachmentsRouter.get("/:id/attachments/:filename", async (req, res) => {
  const chat = await getIdeaChat(req.params.id);
  if (!chat) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const project = await getProject(chat.projectId);
  if (!project) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  // Only ever serves a filename already recorded on this chat (server-
  // generated in saveIdeaChatAttachments) — the URL segment can't be used to
  // request an arbitrary path even before resolveSafePath re-checks it.
  const attachment = chat.messages.flatMap((m) => m.attachments ?? []).find((a) => a.filename === req.params.filename);
  if (!attachment) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  try {
    const target = await resolveSafePath(attachmentsDir(project, chat.id), attachment.filename);
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
