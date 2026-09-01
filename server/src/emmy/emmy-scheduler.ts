import { config } from "../config.js";
import type { EmmyChat, EmmyMessage } from "@overlay/shared";
import { appendMessage, listChats, listMessages, updateChat } from "./emmy-store.js";
import { buildEmmyTurnMessage, sessionKeyFor, turnModelFor } from "./emmy-turn-message.js";
import { sendEmmyHookTurnWithFallback } from "../openclaw/openclaw-webhook.js";
import { publishEmmyMessage } from "./emmy-bus.js";
import { markWorking } from "./emmy-activity.js";
import { appendAuditEntry } from "../audit/audit-log.js";

const ACTOR = "emmy-scheduler";

/**
 * A research turn that was accepted by the gateway but never posted an answer
 * (or even a progress ping) back to /api/emmy/inbound is considered stalled
 * after this many hours — the watchdog then re-dispatches it once on the
 * fallback model. Long deep-research runs are expected; this is well past any
 * legitimate "still reading sources" window with zero sign of life.
 */
const RESEARCH_STALL_HOURS = 4;
/** Give up (and tell Aaron) after this many watchdog re-dispatches. */
const RESEARCH_STALL_MAX_RETRIES = 2;
/** After N consecutive near-identical recurring answers, double the interval (capped). */
const RECURRING_REPEAT_LIMIT = 3;
const RECURRING_MAX_INTERVAL_HOURS = 24 * 7;

/** Rough "did she just say the same thing again" check for recurring-check backoff. */
function normaliseForRepeatCheck(text: string): string {
  return text
    .toLowerCase()
    .replace(/[0-9]+/g, "")
    .replace(/[^a-zäöüß]+/g, " ")
    .trim();
}

function lastRecurringAnswersAreRepeating(messages: EmmyMessage[]): boolean {
  const emmyAnswers = messages.filter((m) => m.role === "emmy").slice(-RECURRING_REPEAT_LIMIT);
  if (emmyAnswers.length < RECURRING_REPEAT_LIMIT) return false;
  const norm = emmyAnswers.map((m) => normaliseForRepeatCheck(m.text));
  return norm.every((n) => n.length > 0 && n === norm[0]);
}

function isDue(chat: EmmyChat, now: number): boolean {
  if (chat.kind !== "task" || chat.status === "done") return false;
  if (chat.category !== "recurring" || !chat.intervalHours) return false;
  const last = chat.lastRecurringCheckAt ?? chat.createdAt;
  return now - new Date(last).getTime() >= chat.intervalHours * 3_600_000;
}

/**
 * One tick of the recurring-tasks scheduler: finds every "recurring" task
 * chat whose interval has elapsed, and drives one OpenClaw agent turn per
 * chat via the same sendEmmyHookTurn/buildEmmyTurnMessage path a manual
 * message uses (emmy.routes.ts) — no parallel implementation.
 *
 * Pure logic, no timer/process code — called from the token-authenticated
 * POST /api/emmy/scheduler/run-now route (emmy-scheduler.routes.ts), which
 * the overlay-emmy-scheduler systemd timer hits via emmy-scheduler.cli.ts.
 * Deliberately NOT called by mutating emmy-store directly from a separate
 * process: emmy-store.ts keeps its JSON store cached in memory per process
 * and only refreshes that cache on its own writes, so a second process
 * writing lastRecurringCheckAt straight to disk would get silently reverted
 * the next time this (the real, long-running) server process writes
 * anything else to the Emmy store. Running the tick in-process, behind an
 * HTTP call, keeps the store's single in-memory cache authoritative.
 *
 * Each chat is isolated in its own try/catch — one dead OpenClaw turn (or a
 * gateway outage) must not stop the rest of an otherwise-due batch, and a
 * failed chat's lastRecurringCheckAt is left untouched so the next tick
 * retries it instead of silently skipping a check.
 */
export async function runRecurringTasksTick(): Promise<{ triggered: string[]; failed: string[] }> {
  const now = Date.now();
  const chats = await listChats();
  const due = chats.filter((chat) => isDue(chat, now));

  const triggered: string[] = [];
  const failed: string[] = [];

  for (const chat of due) {
    try {
      const allMessages = await listMessages(chat.id);

      // Anti-repetition backoff: if her last few automatic answers here were
      // all effectively identical, the check has ossified (same stale query
      // every run). Widen the cadence instead of firing another empty round —
      // she can't reliably change her own interval from inside a turn.
      if (chat.intervalHours && lastRecurringAnswersAreRepeating(allMessages)) {
        const widened = Math.min(chat.intervalHours * 2, RECURRING_MAX_INTERVAL_HOURS);
        if (widened !== chat.intervalHours) {
          await updateChat(chat.id, {
            intervalHours: widened,
            lastRecurringCheckAt: new Date(now).toISOString(),
          });
          console.error(
            `[emmy-scheduler] chat ${chat.id} produced ${RECURRING_REPEAT_LIMIT} near-identical answers in a row — ` +
              `interval ${chat.intervalHours}h -> ${widened}h, skipping this tick.`,
          );
          continue;
        }
      }

      const recentMessages = allMessages.slice(-config.EMMY_MEMORY_RECENT_MESSAGES);
      const userText = `[Automatischer wiederkehrender Check, alle ${chat.intervalHours}h] Bitte die Aufgabe dieses Chats erneut prüfen und ein Update posten.`;
      const prompt = buildEmmyTurnMessage(chat.title, chat.kind, chat.id, userText, recentMessages, chat.category, chat.researchPhase, {
        isFirstMessage: false, // recurring check on an existing chat, never the chat's first turn
      });
      await sendEmmyHookTurnWithFallback(
        sessionKeyFor(chat.id),
        "Overlay Scheduler",
        prompt,
        config.EMMY_RECURRING_MODEL || undefined,
        config.EMMY_RECURRING_FALLBACK_MODEL || undefined,
      );
      await updateChat(chat.id, { lastRecurringCheckAt: new Date(now).toISOString() });
      markWorking(chat.id, undefined, undefined, chat.category);
      triggered.push(chat.id);
    } catch (err) {
      console.error(`[emmy-scheduler] chat ${chat.id} failed: ${(err as Error).message}`);
      failed.push(chat.id);
    }
  }

  if (triggered.length > 0 || failed.length > 0) {
    await appendAuditEntry({
      type: "recurring_task_triggered",
      actor: ACTOR,
      detail: `triggered=${triggered.length} failed=${failed.length}`,
    });
  }

  return { triggered, failed };
}

function isResearchStatusCheckDue(chat: EmmyChat, now: number): boolean {
  if (chat.kind !== "task" || chat.status === "done") return false;
  if (chat.category !== "research" || !chat.dueAt) return false;
  // Already delivered her first summary (or this was already nudged once) —
  // buildEmmyTurnMessage's due-passed block only applies pre-discussion, and
  // dueCheckSentAt makes this fire once per task, not every 15-minute tick.
  if (chat.researchPhase === "discussion" || chat.dueCheckSentAt) return false;
  return now >= new Date(chat.dueAt).getTime();
}

/**
 * One tick of the research-due-check: finds every "research" task chat whose
 * stated dueAt has passed while she's still in the initial research phase (no
 * summary posted yet), and drives one turn per chat asking her explicitly for
 * a status — the actual "need more time vs. here's the result" instructions
 * live in buildEmmyTurnMessage's due-passed branch, not here, same split as
 * runRecurringTasksTick above. Marked with dueCheckSentAt so a task that
 * replies "need 2 more hours" (an activity-only ping, no "text" — see
 * emmy-inbound.routes.ts) isn't re-nudged on every subsequent tick; Aaron can
 * always check back manually via a normal chat message in the meantime.
 */
export async function runResearchDueChecksTick(): Promise<{ triggered: string[]; failed: string[] }> {
  const now = Date.now();
  const chats = await listChats();
  const due = chats.filter((chat) => isResearchStatusCheckDue(chat, now));

  const triggered: string[] = [];
  const failed: string[] = [];

  for (const chat of due) {
    try {
      const recentMessages = (await listMessages(chat.id)).slice(-config.EMMY_MEMORY_RECENT_MESSAGES);
      const userText = `[Automatischer Status-Check] Das Zeitfenster für diese Recherche ist abgelaufen. Wie ist der Stand?`;
      const prompt = buildEmmyTurnMessage(chat.title, chat.kind, chat.id, userText, recentMessages, chat.category, chat.researchPhase, {
        dueAt: chat.dueAt,
        sourceBound: chat.sourceBound,
        isFirstMessage: false, // due-check on an existing research chat
      });
      await sendEmmyHookTurnWithFallback(
        sessionKeyFor(chat.id),
        "Overlay Scheduler",
        prompt,
        turnModelFor(chat.category, chat.researchPhase) || undefined,
        [config.EMMY_RESEARCH_FALLBACK_MODEL || undefined, config.EMMY_RESEARCH_FALLBACK_MODEL_2 || undefined],
      );
      await updateChat(chat.id, { dueCheckSentAt: new Date(now).toISOString() });
      markWorking(chat.id, undefined, undefined, chat.category);
      triggered.push(chat.id);
    } catch (err) {
      console.error(`[emmy-scheduler] research due-check for chat ${chat.id} failed: ${(err as Error).message}`);
      failed.push(chat.id);
    }
  }

  if (triggered.length > 0 || failed.length > 0) {
    await appendAuditEntry({
      type: "research_due_check_triggered",
      actor: ACTOR,
      detail: `triggered=${triggered.length} failed=${failed.length}`,
    });
  }

  return { triggered, failed };
}

/** A research task the watchdog considers stuck: accepted into "in_progress" but
 *  no real answer has landed and nothing has happened for RESEARCH_STALL_HOURS. */
function isResearchStalled(chat: EmmyChat, lastMessageAt: number, now: number): boolean {
  if (chat.kind !== "task" || chat.status !== "in_progress") return false;
  if (chat.category !== "research" || chat.researchPhase === "discussion") return false;
  const refs = [
    new Date(chat.createdAt).getTime(),
    chat.dueCheckSentAt ? new Date(chat.dueCheckSentAt).getTime() : 0,
    chat.researchStallNudgedAt ? new Date(chat.researchStallNudgedAt).getTime() : 0,
    lastMessageAt,
  ].filter((n) => Number.isFinite(n) && n > 0);
  const since = Math.max(...refs);
  return now - since >= RESEARCH_STALL_HOURS * 3_600_000;
}

/**
 * One tick of the stalled-research watchdog. A research turn is fire-and-return
 * (openclaw-webhook.ts): the gateway accepting it (HTTP 200) does not mean the
 * agent turn will ever finish and POST an answer back to /api/emmy/inbound. If
 * it dies mid-run — the Gemini flash model stalling into a 429-backoff loop
 * until the gateway timeout is the known culprit — the chat just hangs on
 * "in_progress" forever, and isResearchStatusCheckDue() stops nudging it once
 * dueCheckSentAt is set. This re-dispatches such a chat up to
 * RESEARCH_STALL_MAX_RETRIES times on the fallback model, then posts a visible
 * message so Aaron knows it's dead instead of silently waiting.
 */
export async function runStalledResearchWatchdogTick(): Promise<{ redispatched: string[]; gaveUp: string[] }> {
  const now = Date.now();
  const chats = await listChats();

  const redispatched: string[] = [];
  const gaveUp: string[] = [];

  for (const chat of chats) {
    const messages = await listMessages(chat.id);
    // Only Emmy's own messages count as a sign of life. Aaron nudging "did
    // this start yet?" is stored as a "me" message and must not reset the
    // stall clock — that would mask a turn that died on the gateway without
    // ever answering.
    const lastEmmyMessage = [...messages].reverse().find((m) => m.role === "emmy");
    const lastMessageAt = lastEmmyMessage ? new Date(lastEmmyMessage.at).getTime() : 0;
    if (!isResearchStalled(chat, lastMessageAt, now)) continue;

    const retries = chat.researchStallRetries ?? 0;

    if (retries >= RESEARCH_STALL_MAX_RETRIES) {
      if (retries === RESEARCH_STALL_MAX_RETRIES) {
        const note = await appendMessage(
          chat.id,
          "emmy",
          `Ich komme bei dieser Recherche nicht durch — der Auftrag wird zwar angenommen, aber der Durchlauf bricht serverseitig ab, bevor ein Ergebnis zurückkommt (nach ${RESEARCH_STALL_MAX_RETRIES} automatischen Neuversuchen). Am besten den Task neu anlegen oder mir hier kurz schreiben, dann stoße ich ihn manuell wieder an.`,
        );
        publishEmmyMessage(note);
        await updateChat(chat.id, { researchStallRetries: retries + 1 });
        gaveUp.push(chat.id);
      }
      continue;
    }

    try {
      const recentMessages = messages.slice(-config.EMMY_MEMORY_RECENT_MESSAGES);
      const userText = `[Automatischer Watchdog] Zu dieser Recherche kam bisher keine Antwort zurück — der vorige Durchlauf ist abgebrochen. Bitte die Recherche neu aufnehmen und wie vereinbart einen Zwischenstand bzw. das Ergebnis an /api/emmy/inbound posten.`;
      const prompt = buildEmmyTurnMessage(chat.title, chat.kind, chat.id, userText, recentMessages, chat.category, chat.researchPhase, {
        dueAt: chat.dueAt,
        sourceBound: chat.sourceBound,
        // Deliberately full instructions here (not isFirstMessage: false like
        // the other scheduler call sites): this fires precisely when the
        // prior turn died mid-run, so we can't be sure the model ever
        // actually saw/retained the full protocol from an earlier turn.
        isFirstMessage: true,
      });
      // Skip the (suspect) primary research model entirely on a re-dispatch —
      // start straight at fallback tier 1 (the other Claude account), then
      // walk the rest of the chain if that's also down. Reuses
      // sendEmmyHookTurnWithFallback's chain/dedup logic rather than a bespoke
      // single-model call, so this stays in sync with the rest of the chain.
      await sendEmmyHookTurnWithFallback(
        sessionKeyFor(chat.id),
        "Overlay Watchdog",
        prompt,
        config.EMMY_RESEARCH_FALLBACK_MODEL || undefined,
        [config.EMMY_RESEARCH_FALLBACK_MODEL_2 || undefined],
      );
      await updateChat(chat.id, {
        researchStallRetries: retries + 1,
        researchStallNudgedAt: new Date(now).toISOString(),
      });
      markWorking(chat.id, undefined, undefined, chat.category);
      redispatched.push(chat.id);
    } catch (err) {
      console.error(`[emmy-scheduler] stalled-research re-dispatch for chat ${chat.id} failed: ${(err as Error).message}`);
    }
  }

  if (redispatched.length > 0 || gaveUp.length > 0) {
    await appendAuditEntry({
      type: "research_watchdog_ran",
      actor: ACTOR,
      detail: `redispatched=${redispatched.length} gaveUp=${gaveUp.length}`,
    });
  }

  return { redispatched, gaveUp };
}
