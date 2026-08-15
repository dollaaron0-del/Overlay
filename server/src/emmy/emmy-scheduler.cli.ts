// Entrypoint for the recurring-tasks scheduler, invoked by the
// overlay-emmy-scheduler systemd timer (see docs/DEPLOYMENT.md) — a separate
// oneshot process, same pattern as backup/cli.ts.
//
// Unlike the backup job, this does NOT run the tick logic in-process against
// emmy-store.ts directly: that store keeps its JSON file cached in memory
// per process and only refreshes the cache on its own writes, so a second
// process (this one) writing lastRecurringCheckAt straight to disk would get
// silently reverted the next time the real, long-running Overlay server
// writes anything else to the Emmy store. Instead this just calls that
// server's own token-authenticated endpoint (see emmy-scheduler.routes.ts),
// so the actual mutation happens inside the one process that owns the cache
// — this CLI is only the thing systemd's timer can independently schedule.
import { config } from "../config.js";

if (!config.AUTOMATION_TOKEN) {
  console.error("[emmy-scheduler] AUTOMATION_TOKEN ist nicht konfiguriert — recurring tasks können nicht ausgelöst werden.");
  process.exit(1);
}

const url = `http://127.0.0.1:${config.PORT}/api/emmy/scheduler/run-now`;

try {
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.AUTOMATION_TOKEN}` },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`${response.status}: ${body.slice(0, 300)}`);
  }
  const result = (await response.json()) as {
    recurring: { triggered: string[]; failed: string[] };
    researchDueChecks: { triggered: string[]; failed: string[] };
  };
  console.log(
    `[emmy-scheduler] recurring: triggered=${result.recurring.triggered.length} failed=${result.recurring.failed.length}; ` +
      `researchDueChecks: triggered=${result.researchDueChecks.triggered.length} failed=${result.researchDueChecks.failed.length}`,
  );
  process.exit(0);
} catch (err) {
  console.error(`[emmy-scheduler] run-now fehlgeschlagen: ${(err as Error).message}`);
  process.exit(1);
}
