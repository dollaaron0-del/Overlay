import { useEffect, useRef, useState } from "react";
import type { BackupProgressMessage } from "@overlay/shared";
import { ReconnectingSocket, wsUrl } from "../../api/ws";

export interface BackupProgress {
  percentDone: number;
  filesDone: number;
  totalFiles: number;
}

/** Live restic backup progress, broadcast to every connected client while any backup (manual or nightly) is running. */
export function useBackupProgress(onDone: () => void): BackupProgress | null {
  const [progress, setProgress] = useState<BackupProgress | null>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    const socket = new ReconnectingSocket<BackupProgressMessage, never>(wsUrl("/ws/backup-progress"));
    const unsubscribe = socket.onMessage((msg) => {
      if (msg.type === "progress") {
        setProgress({ percentDone: msg.percentDone, filesDone: msg.filesDone, totalFiles: msg.totalFiles });
      } else if (msg.type === "done") {
        setProgress(null);
        onDoneRef.current();
      }
    });
    return () => {
      unsubscribe();
      socket.close();
    };
    // Empty deps deliberately: the socket is opened once per mount, not
    // re-opened whenever the caller passes a new onDone identity — the ref
    // above always exposes the latest callback to the message handler.
  }, []);

  return progress;
}
