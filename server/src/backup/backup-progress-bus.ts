import { EventEmitter } from "node:events";
import type { BackupProgressMessage } from "@overlay/shared";

// In-process pub/sub — backup runs in the SAME (unprivileged) process as the
// web server (see backup-job.ts), unlike the security scan, so a plain
// EventEmitter is enough; no cross-process file needed here.
const EVENT = "backup-progress";
const emitter = new EventEmitter();
emitter.setMaxListeners(0);

export function emitBackupProgress(message: BackupProgressMessage): void {
  emitter.emit(EVENT, message);
}

export function subscribeToBackupProgress(onMessage: (message: BackupProgressMessage) => void): () => void {
  emitter.on(EVENT, onMessage);
  return () => emitter.off(EVENT, onMessage);
}
