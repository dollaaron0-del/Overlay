import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { config } from "../config.js";

/**
 * Bearer-token auth for /api/emmy/inbound — same shape as
 * automation.middleware.ts's requireAutomationToken (separate secret, see
 * config.ts EMMY_INBOUND_TOKEN for why it isn't reused). Empty token means
 * "not configured": 404 instead of 401, so the endpoint's existence isn't
 * disclosed until an operator opts in.
 */
export function requireEmmyInboundToken(req: Request, res: Response, next: NextFunction): void {
  if (!config.EMMY_INBOUND_TOKEN) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  const match = /^Bearer (.+)$/.exec(req.header("authorization") ?? "");
  const provided = Buffer.from(match?.[1] ?? "");
  const expected = Buffer.from(config.EMMY_INBOUND_TOKEN);
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  next();
}
