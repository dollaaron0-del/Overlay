import { EventEmitter } from "node:events";
import type { EmmyActivity, EmmyChat, EmmyMessage } from "@overlay/shared";

// In-process pub/sub so every open /ws/emmy connection (e.g. two tabs, or the
// kiosk plus the iPad) sees new messages and chat-list changes live — same
// pattern as deploy-log-bus.ts / backup-progress-bus.ts.
const emitter = new EventEmitter();
emitter.setMaxListeners(0);
const MESSAGE_CHANNEL = "message";
const CHATS_CHANNEL = "chats";
const ACTIVITY_CHANNEL = "activity";

export function publishEmmyMessage(message: EmmyMessage): void {
  emitter.emit(MESSAGE_CHANNEL, message);
}

export function subscribeToEmmyMessages(onMessage: (message: EmmyMessage) => void): () => void {
  emitter.on(MESSAGE_CHANNEL, onMessage);
  return () => emitter.off(MESSAGE_CHANNEL, onMessage);
}

export function publishEmmyChats(chats: EmmyChat[]): void {
  emitter.emit(CHATS_CHANNEL, chats);
}

export function subscribeToEmmyChats(onChats: (chats: EmmyChat[]) => void): () => void {
  emitter.on(CHATS_CHANNEL, onChats);
  return () => emitter.off(CHATS_CHANNEL, onChats);
}

/** Whole list, not a delta — "who is Emmy busy with right now" is small and always sent complete. */
export function publishEmmyActivity(activities: EmmyActivity[]): void {
  emitter.emit(ACTIVITY_CHANNEL, activities);
}

export function subscribeToEmmyActivity(onActivity: (activities: EmmyActivity[]) => void): () => void {
  emitter.on(ACTIVITY_CHANNEL, onActivity);
  return () => emitter.off(ACTIVITY_CHANNEL, onActivity);
}
