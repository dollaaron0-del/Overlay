import { Router } from "express";
import { runRecurringTasksTick, runResearchDueChecksTick, runStalledResearchWatchdogTick } from "./emmy-scheduler.js";
import { listChats } from "./emmy-store.js";
import { publishEmmyChats } from "./emmy-bus.js";

// Token-authenticated (requireAutomationToken, mounted in server.ts), not
// session-cookie-authenticated — the caller is the overlay-emmy-scheduler
// systemd timer via emmy-scheduler.cli.ts, which has no browser session.
// Same trust model as /api/automation/*.
export const emmySchedulerRouter = Router();

emmySchedulerRouter.post("/run-now", async (_req, res) => {
  try {
    const recurring = await runRecurringTasksTick();
    const researchDueChecks = await runResearchDueChecksTick();
    const researchWatchdog = await runStalledResearchWatchdogTick();
    if (
      recurring.triggered.length > 0 ||
      researchDueChecks.triggered.length > 0 ||
      researchWatchdog.redispatched.length > 0 ||
      researchWatchdog.gaveUp.length > 0
    ) {
      publishEmmyChats(await listChats());
    }
    res.json({ recurring, researchDueChecks, researchWatchdog });
  } catch (err) {
    res.status(500).json({ error: "scheduler_tick_failed", message: (err as Error).message });
  }
});
