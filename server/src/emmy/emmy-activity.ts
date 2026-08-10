import type { EmmyActivity } from "@overlay/shared";
import { publishEmmyActivity } from "./emmy-bus.js";

/**
 * Tracks what Emmy is currently doing per chat, so the chat can show "arbeitet
 * gerade daran" instead of leaving Aaron guessing whether a message was picked
 * up at all.
 *
 * Deliberately in-memory: a turn is handed to OpenClaw as fire-and-return
 * (openclaw-webhook.ts) and the answer comes back through /api/emmy/inbound,
 * so "busy" only describes turns this process itself dispatched. After a
 * restart we know nothing about in-flight turns, and claiming she is working
 * would be worse than showing nothing.
 *
 * Two things clear a busy chat: her reply arriving, or the note going stale.
 * The stale timeout exists because a turn that dies in OpenClaw never calls
 * back — without it a chat would spin forever.
 */
const STALE_MS = 15 * 60 * 1000;
const SWEEP_MS = 30 * 1000;

/** Shown while a turn has been accepted but Emmy hasn't reported anything herself yet. */
export const DEFAULT_NOTE = "Emmy hat die Nachricht bekommen und arbeitet daran…";

const activities = new Map<string, EmmyActivity>();
let sweeper: NodeJS.Timeout | null = null;

function dropStale(now: number): boolean {
  let changed = false;
  for (const [chatId, activity] of activities) {
    if (now - new Date(activity.updatedAt).getTime() > STALE_MS) {
      activities.delete(chatId);
      changed = true;
    }
  }
  return changed;
}

function stopSweeperIfIdle(): void {
  if (activities.size === 0 && sweeper) {
    clearInterval(sweeper);
    sweeper = null;
  }
}

function startSweeper(): void {
  if (sweeper) return;
  sweeper = setInterval(() => {
    if (dropStale(Date.now())) publish();
    stopSweeperIfIdle();
  }, SWEEP_MS);
  // Never hold the process open just to expire a note.
  sweeper.unref?.();
}

function publish(): void {
  publishEmmyActivity(listActivities());
}

/** Current activities, newest note first; stale entries are dropped on read. */
export function listActivities(): EmmyActivity[] {
  dropStale(Date.now());
  stopSweeperIfIdle();
  return [...activities.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getActivity(chatId: string): EmmyActivity | undefined {
  return listActivities().find((a) => a.chatId === chatId);
}

/**
 * Marks a chat as being worked on. Re-marking an already-busy chat keeps the
 * original `since` (the UI shows one continuous "seit …") and only refreshes
 * the note — that is how Emmy's own progress pings read as one running task.
 */
export function markWorking(chatId: string, note?: string): EmmyActivity {
  const now = new Date().toISOString();
  const existing = activities.get(chatId);
  const activity: EmmyActivity = {
    chatId,
    note: note?.trim() || existing?.note || DEFAULT_NOTE,
    since: existing?.since ?? now,
    updatedAt: now,
  };
  activities.set(chatId, activity);
  startSweeper();
  publish();
  return activity;
}

/** Clears a chat's activity. No-op (and no broadcast) if it wasn't busy. */
export function markIdle(chatId: string): void {
  if (!activities.delete(chatId)) return;
  stopSweeperIfIdle();
  publish();
}

/** Test seam: forget everything without broadcasting. */
export function resetActivityForTests(): void {
  activities.clear();
  stopSweeperIfIdle();
}
