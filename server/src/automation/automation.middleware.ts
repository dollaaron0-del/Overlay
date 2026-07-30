import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { config } from "../config.js";

/**
 * Bearer-token auth for /api/automation/* — deliberately separate from the
 * session-cookie auth the browser UI uses, since a script/gateway (e.g.
 * OpenClaw) has no browser session to present. Empty AUTOMATION_TOKEN means
 * "not configured": 404 instead of 401, so the router's existence isn't
 * even disclosed until an operator opts in.
 */
export function requireAutomationToken(req: Request, res: Response, next: NextFunction): void {
  if (!config.AUTOMATION_TOKEN) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  const match = /^Bearer (.+)$/.exec(req.header("authorization") ?? "");
  const provided = Buffer.from(match?.[1] ?? "");
  const expected = Buffer.from(config.AUTOMATION_TOKEN);
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  next();
}
