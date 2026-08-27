import { captureCpuHealthSnapshot } from "./cpu-health.js";
import { appendCpuHealthSnapshot } from "./cpu-health-store.js";

const CAPTURE_INTERVAL_MS = 5 * 60 * 1000;

// Runs independently of any client connection so history keeps accumulating
// whether or not the widget is ever opened. /health/current (see
// system.routes.ts) captures its own live snapshot on top of this and does
// not read from the store, so this interval only feeds /health/history.
export function startCpuHealthScheduler(): void {
  const tick = () => {
    void captureCpuHealthSnapshot()
      .then(appendCpuHealthSnapshot)
      .catch((err) => console.error("[cpu-health] snapshot capture failed", err));
  };
  tick();
  setInterval(tick, CAPTURE_INTERVAL_MS);
}
