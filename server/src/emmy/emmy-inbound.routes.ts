import { Router } from "express";
import { z } from "zod";
import { appendEmmyMessage } from "./emmy-store.js";
import { publishEmmyMessage } from "./emmy-bus.js";

/**
 * Called by OpenClaw when the Emmy agent replies to a message sent via
 * sendEmmyChatMessage — the inbound half of the two-way Emmy chat. Mounted
 * with requireEmmyInboundToken (Bearer-token auth), NOT session auth: this
 * is a server-to-server callback with no browser session to present, same
 * reasoning as /api/automation/*.
 */
export const emmyInboundRouter = Router();

const inboundSchema = z.object({
  text: z.string().min(1).max(4_000),
});

emmyInboundRouter.post("/", async (req, res) => {
  const parsed = inboundSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", details: parsed.error.issues });
    return;
  }

  const message = await appendEmmyMessage("emmy", parsed.data.text);
  publishEmmyMessage(message);
  res.status(201).json({ ok: true });
});
