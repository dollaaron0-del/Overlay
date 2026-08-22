import { Router } from "express";
import { runRecurringTasksTick, runResearchDueChecksTick } from "./emmy-scheduler.js";
import { listChats } from "./emmy-store.js";
import { publishEmmyChats } from "./emmy-bus.js";

// Token-authenticated (requireSchedulerToken, mounted in server.ts), not
// session-cookie-authenticated — the caller is the overlay-emmy-scheduler
// systemd timer via emmy-scheduler.cli.ts, which has no browser session.
// The token is internal and self-provisioning (emmy-scheduler-token.ts), so
// unlike /api/automation/* this route needs no operator configuration.
export const emmySchedulerRouter = Router();

emmySchedulerRouter.post("/run-now", async (_req, res) => {
  try {
    const recurring = await runRecurringTasksTick();
    const researchDueChecks = await runResearchDueChecksTick();
    if (recurring.triggered.length > 0 || researchDueChecks.triggered.length > 0) {
      publishEmmyChats(await listChats());
    }
    res.json({ recurring, researchDueChecks });
  } catch (err) {
    res.status(500).json({ error: "scheduler_tick_failed", message: (err as Error).message });
  }
});
