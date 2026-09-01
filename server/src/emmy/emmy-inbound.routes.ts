import { Router } from "express";
import { z } from "zod";
import type { EmmyAttachment } from "@overlay/shared";
import { EMMY_LONG_REPORT_CHARS } from "@overlay/shared";
import { getChat, updateChat, appendMessage, listChats } from "./emmy-store.js";
import { publishEmmyMessage, publishEmmyChats } from "./emmy-bus.js";
import { markWorking, markIdle } from "./emmy-activity.js";
import { indexMessageForMemory } from "./emmy-memory.js";
import { MIN_RESEARCH_FLOOR_MINUTES } from "./emmy-categorize.js";
import { sessionKeyFor, turnModelFor } from "./emmy-turn-message.js";
import { sendEmmyHookTurn } from "../openclaw/openclaw-webhook.js";
import { renderMarkdownToPdf, pdfFilenameFor } from "./emmy-pdf.js";
import { saveGeneratedAttachment } from "./emmy-attachments.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A short pause before dispatching the "too early" nudge (see the caller).
 *
 * This handler runs synchronously off the inbound POST of the very turn that
 * is being nudged — its own OpenClaw session on this sessionKey is still
 * tearing down when we get here. Gateway hook dispatches respond with
 * {ok:true, runId} as soon as the request is accepted, BEFORE the actual
 * isolated turn (and any session-lifecycle claim conflict) plays out in the
 * background — so a failed dispatch never surfaces back to this HTTP call to
 * retry on. A short delay before dispatching is what actually reduces the
 * collision, not a retry after the fact.
 */
const NUDGE_DISPATCH_DELAY_MS = 2000;

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
    /** Research-only: her own read on whether this task is bound to one named source (URL/channel/document) rather than an open topic — see EmmyChat.sourceBound. */
    sourceBound: z.boolean().optional(),
    /** Running count of sources looked at so far this task. */
    sourcesSearched: z.number().int().nonnegative().max(10_000).optional(),
    /** Her own 0-100 estimate of how well she now knows the topic. */
    knowledgeLevel: z.number().min(0).max(100).optional(),
    /** Set alongside "text" when this reply is a clarifying question, not the research summary — see buildEmmyTurnMessage's research branch. */
    needsClarification: z.boolean().optional(),
    /**
     * Set alongside "text" for a substantial interim post (e.g. the research
     * plan checkpoint, or a progress dump before a supervising model can take
     * over — see the "Plan-Zwischenstand" and orchestrator/worker split in
     * buildEmmyTurnMessage's research branch) that should persist as a real
     * chat message — unlike a plain "activity" ping — without ending the
     * research-gathering phase. Same phase-holding effect as
     * needsClarification, but this isn't a question, so it renders as a
     * normal message, not a clarification bubble.
     */
    interim: z.boolean().optional(),
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
  const {
    chatId,
    text,
    activity,
    category,
    dueAt,
    intervalHours,
    sourcesSearched,
    knowledgeLevel,
    needsClarification,
    interim,
    sourceBound,
  } = parsed.data;
  // Both needsClarification and interim mean "this text reply doesn't
  // conclude the research-gathering phase" — a question and a substantial
  // progress post are different in kind but the same in that regard. Kept as
  // two fields (not merged into one) so the UI/needsClarification's own
  // "is this a question" meaning stays unambiguous for appendMessage below.
  const nonFinal = needsClarification === true || interim === true;

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

  // Her source-bound read isn't gated by the manual-category lock: it's a
  // separate axis (completion shape, not category) she can update on any
  // turn — e.g. she only realizes a task is source-bound once she's a few
  // sources in.
  const effectiveSourceBound = sourceBound ?? chat.sourceBound;
  if (sourceBound !== undefined) {
    await updateChat(chatId, { sourceBound });
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

  // A clarifying question or interim post is never the final document, even
  // if Aaron had one pending — the pending request stays queued for whenever
  // she actually delivers the summary (see pendingFinalDocument handling
  // below).
  const isFinalDocument = chat.pendingFinalDocument === true && !nonFinal;
  // Same "long report" threshold the web UI uses to clip the inline preview
  // (see EMMY_LONG_REPORT_CHARS) — whenever that preview would kick in, a
  // real PDF is generated alongside it so the full text is never trapped
  // behind the clipped bubble, only a click away as an actual document.
  // Clarifying questions and interim posts are conversation, not reports —
  // never a PDF.
  let attachments: EmmyAttachment[] | undefined;
  if (!nonFinal && (isFinalDocument || text.length > EMMY_LONG_REPORT_CHARS)) {
    try {
      const pdf = await renderMarkdownToPdf(text, chat.title);
      const filename = pdfFilenameFor(chat.title, new Date().toISOString());
      attachments = [await saveGeneratedAttachment(chatId, pdf, filename, "application/pdf")];
    } catch {
      // The chat message itself must still land even if PDF rendering fails
      // for some reason (e.g. pathological markdown) — no attachment then.
    }
  }

  const message = await appendMessage(chatId, "emmy", text, attachments, isFinalDocument, needsClarification === true);
  publishEmmyMessage(message);
  void indexMessageForMemory(message, chat.title).catch(() => {});
  // The answer is here, so she is no longer working on this chat.
  markIdle(chatId);

  // Her first full answer in a research chat would normally end the deep-
  // research phase. The task's own dueAt is a deadline ("done by then"), not
  // a target to fill — genuine completion (further sources/time wouldn't add
  // value) is valid at any point before it, source-bound or not (see
  // EmmyChat.sourceBound and the prompt's research block). So this floor is
  // deliberately just a sanity check against a five-second non-answer, not a
  // padding requirement derived from the time window.
  const isFirstResearchSummary =
    effectiveCategory === "research" &&
    chat.researchPhase !== "discussion" &&
    chat.pendingFinalDocument !== true &&
    !nonFinal;
  if (isFirstResearchSummary) {
    const minRequiredMs = MIN_RESEARCH_FLOOR_MINUTES * 60_000;
    const elapsedMs = Date.now() - new Date(chat.createdAt).getTime();

    if (elapsedMs < minRequiredMs) {
      const nudge = [
        `[Overlay] Automatische Rückmeldung zur Aufgabe „${chat.title}":`,
        ``,
        `Deine letzte Antwort kam nach nur ${Math.round(elapsedMs / 60_000)} Minuten — für diese Recherche-Aufgabe sind mindestens ${Math.round(minRequiredMs / 60_000)} Minuten vorgesehen (noch ca. ${Math.ceil((minRequiredMs - elapsedMs) / 60_000)} Minuten mehr).`,
        `Deine bisherige Antwort wurde als Zwischenstand gespeichert und ist für Aaron im Chat sichtbar — sie zählt aber noch NICHT als deine Recherche-Zusammenfassung, die Phase bleibt offen.`,
        effectiveSourceBound
          ? `Recherchier weiter: arbeite die genannte Quelle wirklich vollständig durch, bevor du abschließt. Melde dich zwischendurch gern mit Zwischenstand-Meldungen (activity/sourcesSearched/knowledgeLevel) und schick danach über denselben Endpunkt deine Zusammenfassung.`
          : `Recherchier weiter: erschließ neue, unabhängige Quellen, vertiefe Punkte, die noch dünn sind. Melde dich zwischendurch gern mit Zwischenstand-Meldungen (activity/sourcesSearched/knowledgeLevel) und schick danach über denselben Endpunkt eine vollständigere Zusammenfassung.`,
      ].join("\n");

      try {
        // See NUDGE_DISPATCH_DELAY_MS above — give the still-finishing turn
        // a moment to release its session-lifecycle claim before contending
        // for the same sessionKey.
        await sleep(NUDGE_DISPATCH_DELAY_MS);
        await sendEmmyHookTurn(
          sessionKeyFor(chatId),
          `Overlay-Aufgabe: ${chat.title}`,
          nudge,
          turnModelFor(effectiveCategory, chat.researchPhase),
        );
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
  // A clarifying question is neither: she's still pre-research, so the phase
  // stays put and a pending final-document request stays queued.
  const researchSummaryLanded =
    effectiveCategory === "research" && chat.researchPhase !== "discussion" && !nonFinal;
  await updateChat(chatId, {
    pendingFinalDocument: nonFinal ? chat.pendingFinalDocument : false,
    ...(researchSummaryLanded ? { researchPhase: "discussion" as const } : {}),
    // The gathering phase is over — drop the persisted "running" flag the
    // dispatch set (emmy.routes.ts) so the sidebar stops listing it as active
    // research. The report itself is in the chat as a message/PDF.
    ...(researchSummaryLanded && chat.status === "in_progress" ? { status: "open" as const } : {}),
  });

  publishEmmyChats(await listChats());
  res.status(201).json({ ok: true });
});
