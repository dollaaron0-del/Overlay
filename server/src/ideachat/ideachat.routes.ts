import { Router } from "express";
import { z } from "zod";
import { getProject, resolveProjectDir } from "../projects/projects.registry.js";
import { listIdeaChats, getIdeaChat, createIdeaChat, appendIdeaChatMessages } from "./ideachat-store.js";
import { sendIdeaChatMessage } from "./ideachat.js";
import { writeIdeaPlan } from "./plan-writer.js";
import { appendAuditEntry } from "../audit/audit-log.js";

export const ideaChatRouter = Router();

ideaChatRouter.get("/", async (_req, res) => {
  const chats = await listIdeaChats();
  res.json(chats.map(({ id, projectId, title, createdAt, updatedAt }) => ({ id, projectId, title, createdAt, updatedAt })));
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

  let reply: Awaited<ReturnType<typeof sendIdeaChatMessage>>;
  try {
    reply = await sendIdeaChatMessage(message, resolveProjectDir(project), null);
  } catch (err) {
    res.status(502).json({ error: "chat_failed", message: (err as Error).message });
    return;
  }

  // Only persisted once the AI call actually succeeded, so a failure never
  // leaves a chat behind with a message nobody answered.
  const chat = await createIdeaChat(projectId, message);
  const updated = await appendIdeaChatMessages(
    chat.id,
    [{ role: "assistant", text: reply.reply, at: new Date().toISOString() }],
    reply.sessionId,
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

  let reply: Awaited<ReturnType<typeof sendIdeaChatMessage>>;
  try {
    reply = await sendIdeaChatMessage(parsed.data.message, resolveProjectDir(project), chat.claudeSessionId);
  } catch (err) {
    res.status(502).json({ error: "chat_failed", message: (err as Error).message });
    return;
  }

  const now = new Date().toISOString();
  const updated = await appendIdeaChatMessages(
    chat.id,
    [
      { role: "user", text: parsed.data.message, at: now },
      { role: "assistant", text: reply.reply, at: new Date().toISOString() },
    ],
    reply.sessionId,
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
    res.json({ ok: true, filename, relativePath });
  } catch (err) {
    res.status(400).json({ error: "save_failed", message: (err as Error).message });
  }
});
