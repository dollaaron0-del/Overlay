import { Router } from "express";
import { z } from "zod";
import { getChat, updateChat, appendMessage, listChats } from "./emmy-store.js";
import { publishEmmyMessage, publishEmmyChats } from "./emmy-bus.js";
import { markWorking, markIdle } from "./emmy-activity.js";
import { indexMessageForMemory } from "./emmy-memory.js";
import { minResearchDurationMs, DEFAULT_RESEARCH_WINDOW_HOURS, defaultsForCategory } from "./emmy-categorize.js";
import { sessionKeyFor } from "./emmy-turn-message.js";
import { sendEmmyHookTurn } from "../openclaw/openclaw-webhook.js";

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
    await updateChat(chatId, {
      category,
      categorySource: "auto",
      ...defaultsForCategory(category, chat, dueAt, intervalHours),
    });
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

  const message = await appendMessage(chatId, "emmy", text, undefined, chat.pendingFinalDocument === true);
  publishEmmyMessage(message);
  void indexMessageForMemory(message, chat.title).catch(() => {});
  // The answer is here, so she is no longer working on this chat.
  markIdle(chatId);

  // Her first full answer in a research chat would normally end the deep-
  // research phase — but the "take your time" instruction in the prompt is
  // only advisory, so enforce a floor here: if it lands far too early inside
  // the task's own stated time window (see minResearchDurationMs), keep it as
  // an interim message and send her straight back in rather than accepting it
  // as the researched summary. Final-document replies are exempt — those are
  // an explicit wrap-up Aaron asked for, not the initial dig-in.
  const isFirstResearchSummary =
    effectiveCategory === "research" && chat.researchPhase !== "discussion" && chat.pendingFinalDocument !== true;
  if (isFirstResearchSummary) {
    const windowMs = chat.dueAt
      ? new Date(chat.dueAt).getTime() - new Date(chat.createdAt).getTime()
      : DEFAULT_RESEARCH_WINDOW_HOURS * 3_600_000;
    const minRequiredMs = minResearchDurationMs(windowMs);
    const elapsedMs = Date.now() - new Date(chat.createdAt).getTime();

    if (elapsedMs < minRequiredMs) {
      const nudge = [
        `[Overlay] Automatische Rückmeldung zur Aufgabe „${chat.title}":`,
        ``,
        `Deine letzte Antwort kam nach nur ${Math.round(elapsedMs / 60_000)} Minuten — für diese Recherche-Aufgabe sind mindestens ${Math.round(minRequiredMs / 60_000)} Minuten vorgesehen (noch ca. ${Math.ceil((minRequiredMs - elapsedMs) / 60_000)} Minuten mehr).`,
        `Deine bisherige Antwort wurde als Zwischenstand gespeichert und ist für Aaron im Chat sichtbar — sie zählt aber noch NICHT als deine Recherche-Zusammenfassung, die Phase bleibt offen.`,
        `Recherchier weiter: erschließ neue, unabhängige Quellen, vertiefe Punkte, die noch dünn sind. Melde dich zwischendurch gern mit Zwischenstand-Meldungen (activity/sourcesSearched/knowledgeLevel) und schick danach über denselben Endpunkt eine vollständigere Zusammenfassung.`,
      ].join("\n");

      try {
        await sendEmmyHookTurn(sessionKeyFor(chatId), `Overlay-Aufgabe: ${chat.title}`, nudge);
        markWorking(
          chatId,
          "Recherchiert weiter (Mindestzeit für diese Aufgabe noch nicht erreicht)…",
          { sourcesSearched, knowledgeLevel },
          effectiveCategory,
        );
      } catch {
        // Nothing will pick this back up on its own — leave the chat idle
        // rather than showing "arbeitet daran" forever.
      }

      publishEmmyChats(await listChats());
      res.status(201).json({ ok: true, tooEarly: true });
      return;
    }
  }

  // Her first full answer in a research chat is the summary that moves the
  // conversation from the deep-research phase into Q&A/feedback — and any
  // pending final-document request has now been fulfilled by this reply.
  await updateChat(chatId, {
    pendingFinalDocument: false,
    ...(effectiveCategory === "research" && chat.researchPhase !== "discussion"
      ? { researchPhase: "discussion" as const }
      : {}),
  });

  publishEmmyChats(await listChats());
  res.status(201).json({ ok: true });
});
