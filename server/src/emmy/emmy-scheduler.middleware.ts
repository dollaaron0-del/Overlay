import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { config } from "../config.js";
import { getSchedulerToken } from "./emmy-scheduler-token.js";

function matches(provided: string, expected: string): boolean {
  if (!expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Auth for /api/emmy/scheduler/* — the internal tick the systemd timer fires.
 *
 * Accepts the auto-generated internal token (emmy-scheduler-token.ts) so
 * recurring tasks work on a stock install with no operator setup, and still
 * accepts AUTOMATION_TOKEN so any existing deployment that was configured
 * against the old behaviour keeps working.
 *
 * Unlike requireAutomationToken this never 404s: the internal token always
 * exists, so "not configured" isn't a reachable state and hiding the route
 * would only obscure a real auth failure. Note the route stays token-gated
 * rather than IP-gated — the app sets `trust proxy: loopback`, so a plain
 * 127.0.0.1 check would not reliably distinguish the local CLI from a
 * request arriving through the reverse proxy.
 */
export function requireSchedulerToken(req: Request, res: Response, next: NextFunction): void {
  const provided = /^Bearer (.+)$/.exec(req.header("authorization") ?? "")?.[1] ?? "";
  if (!provided) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  if (matches(provided, getSchedulerToken()) || matches(provided, config.AUTOMATION_TOKEN)) {
    next();
    return;
  }

  res.status(401).json({ error: "unauthorized" });
}
