import { Router } from "express";
import { listDecisions } from "./agent-decisions-store.js";

// Session-authed reads (mounted under protectedApi). Writing happens only via
// agent-decisions-inbound.routes.ts — an agent posts its own decisions, Aaron
// only ever reads them here.
export const agentDecisionsRouter = Router();

agentDecisionsRouter.get("/", async (req, res) => {
  const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
  res.json(await listDecisions(projectId));
});
