import { Router } from "express";
import { z } from "zod";
import { getChat, updateChat, appendMessage, listChats } from "./emmy-store.js";
import { publishEmmyMessage, publishEmmyChats } from "./emmy-bus.js";
import { markWorking, markIdle } from "./emmy-activity.js";
import { indexMessageForMemory } from "./emmy-memory.js";

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
    // Generous enough for a full, multi-section research report (tens of
    // thousands of words) instead of forcing Emmy to compress a thorough
    // answer down to fit — see EMMY_INBOUND_BODY_LIMIT in server.ts, which
    // must stay large enough for a JSON body built around a string this long.
    text: z.string().min(1).max(300_000).optional(),
    /** One line on what she's doing right now. */
    activity: z.string().max(300).optional(),
    /** Her own correction of Overlay's automatic categorization; ignored once Aaron picked one. */
    category: z.enum(["instant", "research", "recurring"]).optional(),
    dueAt: z.string().datetime().optional(),
    intervalHours: z.number().positive().max(24 * 365).optional(),
    /** Running count of sources looked at so far this task. */
    sourcesSearched: z.number().int().nonnegative().max(10_000).optional(),
    /** Her own 0-100 estimate of how well she now knows the topic. */
    knowledgeLevel: z.number().min(0).max(100).optional(),
  })
  .refine(
    (body) =>
      body.text !== undefined ||
      body.activity !== undefined ||
      body.category !== undefined ||
      body.sourcesSearched !== undefined ||
      body.knowledgeLevel !== undefined,
    { message: "expected one of: text, activity, category, sourcesSearched, knowledgeLevel" },
  );

emmyInboundRouter.post("/", async (req, res) => {
  const parsed = inboundSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", details: parsed.error.issues });
    return;
  }
  const { chatId, text, activity, category, dueAt, intervalHours, sourcesSearched, knowledgeLevel } = parsed.data;

  const chat = await getChat(chatId);
  if (!chat) {
    res.status(404).json({ error: "chat_not_found" });
    return;
  }

  // A manual category is Aaron's call and outranks hers.
  let effectiveCategory = chat.category;
  if (category && chat.kind === "task" && chat.categorySource !== "manual") {
    await updateChat(chatId, { category, categorySource: "auto", dueAt, intervalHours });
    effectiveCategory = category;
  }

  // Persisted on the chat itself (not just the ephemeral activity) so the
  // sidebar keeps showing "12 Quellen · 60% Wissensstand" after she goes idle
  // or the server restarts, not just while a turn is in flight.
  if (sourcesSearched !== undefined || knowledgeLevel !== undefined) {
    await updateChat(chatId, { sourcesSearched, knowledgeLevel });
  }

  if (!text) {
    markWorking(chatId, activity, { sourcesSearched, knowledgeLevel }, effectiveCategory);
    publishEmmyChats(await listChats());
    res.status(202).json({ ok: true, working: true });
    return;
  }

  const message = await appendMessage(chatId, "emmy", text);
  publishEmmyMessage(message);
  void indexMessageForMemory(message, chat.title).catch(() => {});
  // The answer is here, so she is no longer working on this chat.
  markIdle(chatId);
  publishEmmyChats(await listChats());
  res.status(201).json({ ok: true });
});
