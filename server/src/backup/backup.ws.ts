import type { WebSocket } from "ws";
import type { BackupProgressMessage } from "@overlay/shared";
import { subscribeToBackupProgress } from "./backup-progress-bus.js";

export function handleBackupProgressConnection(ws: WebSocket): void {
  const send = (msg: BackupProgressMessage) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };

  const unsubscribe = subscribeToBackupProgress(send);
  ws.on("close", () => unsubscribe());
}
