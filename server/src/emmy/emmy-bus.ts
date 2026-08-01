import { EventEmitter } from "node:events";
import type { EmmyMessage } from "@overlay/shared";

// In-process pub/sub so every open /ws/emmy connection (e.g. two tabs, or
// the sender's own tab plus a second device) sees a new message live —
// same pattern as deploy-log-bus.ts / backup-progress-bus.ts.
const emitter = new EventEmitter();
emitter.setMaxListeners(0);
const CHANNEL = "message";

export function publishEmmyMessage(message: EmmyMessage): void {
  emitter.emit(CHANNEL, message);
}

export function subscribeToEmmyMessages(onMessage: (message: EmmyMessage) => void): () => void {
  emitter.on(CHANNEL, onMessage);
  return () => emitter.off(CHANNEL, onMessage);
}
