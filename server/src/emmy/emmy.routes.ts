import { Router } from "express";
import { z } from "zod";
import { listEmmyMessages, appendEmmyMessage } from "./emmy-store.js";
import { publishEmmyMessage } from "./emmy-bus.js";
import { sendEmmyChatMessage } from "../openclaw/openclaw-webhook.js";

export const emmyRouter = Router();

emmyRouter.get("/messages", async (_req, res) => {
  res.json(await listEmmyMessages());
});

const sendSchema = z.object({
  text: z.string().min(1).max(4_000),
});

emmyRouter.post("/messages", async (req, res) => {
  const parsed = sendSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", details: parsed.error.issues });
    return;
  }

  // Saved and broadcast to any other open Emmy tabs before the outbound
  // send is even attempted — a failed send (network hiccup, OpenClaw down)
  // must not make the message disappear from the sender's own view, it
  // should just show as "not delivered".
  const message = await appendEmmyMessage("me", parsed.data.text);
  publishEmmyMessage(message);

  try {
    await sendEmmyChatMessage(parsed.data.text);
  } catch (err) {
    res.status(502).json({ error: "openclaw_send_failed", message: (err as Error).message, saved: message });
    return;
  }

  res.status(201).json(message);
});
