import { Router } from "express";
import { z } from "zod";
import { getChat, updateChat, appendMessage, listChats } from "./emmy-store.js";
import { publishEmmyMessage, publishEmmyChats } from "./emmy-bus.js";
import { markWorking, markIdle } from "./emmy-activity.js";

/**
 * Called by the Emmy agent turn when it replies to a chat message (see
 * buildPrompt in emmy.routes.ts — the turn is told this URL, token and the
 * chatId to tag its answer with). The inbound half of the two-way Emmy chat.
 * Mounted with requireEmmyInboundToken (Bearer-token auth), NOT session auth:
 * this is a server-to-server callback with no browser session to present,
 * same reasoning as /api/automation/*.
 *
 * Two kinds of call arrive here:
 *   - with "text": the actual answer — appended to the chat, ends the turn.
 *   - without "text", with "activity": a progress note while she works, shown
 *     live in the chat header and dropped again when the answer lands.
 */
export const emmyInboundRouter = Router();

const inboundSchema = z
  .object({
    chatId: z.string().min(1),
    text: z.string().min(1).max(20_000).optional(),
    /** One line on what she's doing right now. */
    activity: z.string().max(300).optional(),
    /** Her own correction of Overlay's automatic categorization; ignored once Aaron picked one. */
    category: z.enum(["instant", "research", "recurring"]).optional(),
    dueAt: z.string().datetime().optional(),
    intervalHours: z.number().positive().max(24 * 365).optional(),
  })
  .refine((body) => body.text !== undefined || body.activity !== undefined || body.category !== undefined, {
    message: "expected one of: text, activity, category",
  });

emmyInboundRouter.post("/", async (req, res) => {
  const parsed = inboundSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", details: parsed.error.issues });
    return;
  }
  const { chatId, text, activity, category, dueAt, intervalHours } = parsed.data;

  const chat = await getChat(chatId);
  if (!chat) {
    res.status(404).json({ error: "chat_not_found" });
    return;
  }

  // A manual category is Aaron's call and outranks hers.
  if (category && chat.kind === "task" && chat.categorySource !== "manual") {
    await updateChat(chatId, { category, categorySource: "auto", dueAt, intervalHours });
  }

  if (!text) {
    markWorking(chatId, activity);
    publishEmmyChats(await listChats());
    res.status(202).json({ ok: true, working: true });
    return;
  }

  const message = await appendMessage(chatId, "emmy", text);
  publishEmmyMessage(message);
  // The answer is here, so she is no longer working on this chat.
  markIdle(chatId);
  publishEmmyChats(await listChats());
  res.status(201).json({ ok: true });
});
