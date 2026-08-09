import { EventEmitter } from "node:events";
import type { EmmyChat, EmmyMessage } from "@overlay/shared";

// In-process pub/sub so every open /ws/emmy connection (e.g. two tabs, or the
// kiosk plus the iPad) sees new messages and chat-list changes live — same
// pattern as deploy-log-bus.ts / backup-progress-bus.ts.
const emitter = new EventEmitter();
emitter.setMaxListeners(0);
const MESSAGE_CHANNEL = "message";
const CHATS_CHANNEL = "chats";

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
