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
