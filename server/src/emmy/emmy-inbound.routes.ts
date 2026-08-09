import { Router } from "express";
import { z } from "zod";
import { getChat, appendMessage, listChats } from "./emmy-store.js";
import { publishEmmyMessage, publishEmmyChats } from "./emmy-bus.js";

/**
 * Called by the Emmy agent turn when it replies to a chat message (see
 * buildPrompt in emmy.routes.ts — the turn is told this URL, token and the
 * chatId to tag its answer with). The inbound half of the two-way Emmy chat.
 * Mounted with requireEmmyInboundToken (Bearer-token auth), NOT session auth:
 * this is a server-to-server callback with no browser session to present,
 * same reasoning as /api/automation/*.
 */
export const emmyInboundRouter = Router();

const inboundSchema = z.object({
  chatId: z.string().min(1),
  text: z.string().min(1).max(20_000),
});

emmyInboundRouter.post("/", async (req, res) => {
  const parsed = inboundSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", details: parsed.error.issues });
    return;
  }

  const chat = await getChat(parsed.data.chatId);
  if (!chat) {
    res.status(404).json({ error: "chat_not_found" });
    return;
  }

  const message = await appendMessage(parsed.data.chatId, "emmy", parsed.data.text);
  publishEmmyMessage(message);
  publishEmmyChats(await listChats());
  res.status(201).json({ ok: true });
});
