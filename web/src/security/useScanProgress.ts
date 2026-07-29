import { useEffect, useRef, useState } from "react";
import type { ScanProgress } from "@overlay/shared";
import { api } from "../api/client";

const POLL_INTERVAL_MS = 2000;

/**
 * Polls the scan-progress file (see server/src/security/scan-progress-store.ts)
 * rather than pushing over a WebSocket — the scan runs as a separate,
 * root-privileged process (see docs/SECURITY.md "Sicherheits-Scan"), so
 * there's no in-process connection to push from, unlike backup progress.
 */
export function useScanProgress(onDone: () => void): ScanProgress | null {
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const wasRunningRef = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      const current = await api.get<ScanProgress | null>("/api/security/scan-progress").catch(() => null);
      if (stopped) return;
      setProgress(current);
      if (current) {
        wasRunningRef.current = true;
      } else if (wasRunningRef.current) {
        wasRunningRef.current = false;
        onDoneRef.current();
      }
    };
    void tick();
    const interval = setInterval(() => void tick(), POLL_INTERVAL_MS);
    return () => {
      stopped = true;
      clearInterval(interval);
    };
  }, []);

  return progress;
}
