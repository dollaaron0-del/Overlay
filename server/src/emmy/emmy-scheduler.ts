import { config } from "../config.js";
import type { EmmyChat } from "@overlay/shared";
import { listChats, listMessages, updateChat } from "./emmy-store.js";
import { buildEmmyTurnMessage, sessionKeyFor } from "./emmy-turn-message.js";
import { sendEmmyHookTurn } from "../openclaw/openclaw-webhook.js";
import { markWorking } from "./emmy-activity.js";
import { appendAuditEntry } from "../audit/audit-log.js";

const ACTOR = "emmy-scheduler";

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
      const recentMessages = (await listMessages(chat.id)).slice(-config.EMMY_MEMORY_RECENT_MESSAGES);
      const userText = `[Automatischer wiederkehrender Check, alle ${chat.intervalHours}h] Bitte die Aufgabe dieses Chats erneut prüfen und ein Update posten.`;
      const prompt = buildEmmyTurnMessage(chat.title, chat.kind, chat.id, userText, recentMessages, chat.category, chat.researchPhase);
      await sendEmmyHookTurn(sessionKeyFor(chat.id), "Overlay Scheduler", prompt);
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
      });
      await sendEmmyHookTurn(sessionKeyFor(chat.id), "Overlay Scheduler", prompt);
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
