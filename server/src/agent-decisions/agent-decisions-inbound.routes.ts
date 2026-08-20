import { Router } from "express";
import { z } from "zod";
import { createDecision } from "./agent-decisions-store.js";
import { publishAgentDecision } from "./agent-decisions-bus.js";

/**
 * Called by an agent (Emmy today; any future project bot the same way) to
 * record a decision it made, together with why — the sources it drew on and
 * its reasoning — so the Agent-Status-Board can show the process, not just
 * the result. Mounted with requireEmmyInboundToken (Bearer-token auth), same
 * server-to-server trust boundary as emmy-inbound.routes.ts: there is no
 * browser session to present here either.
 */
export const agentDecisionsInboundRouter = Router();

const sourceSchema = z.object({
  label: z.string().min(1).max(300),
  url: z.string().url().max(2000).optional(),
});

const inboundSchema = z.object({
  agentId: z.string().min(1).max(100),
  projectId: z.string().min(1).max(200).optional(),
  title: z.string().min(1).max(300),
  outcome: z.string().min(1).max(2000),
  reasoning: z.string().min(1).max(20_000),
  sources: z.array(sourceSchema).max(50).default([]),
  sentiment: z.enum(["bullish", "neutral", "bearish"]).optional(),
});

agentDecisionsInboundRouter.post("/", async (req, res) => {
  const parsed = inboundSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", details: parsed.error.issues });
    return;
  }

  const decision = await createDecision(parsed.data);
  publishAgentDecision(decision);
  res.status(201).json(decision);
});
