import type { NextFunction, Request, Response } from "express";
import * as cookie from "cookie";
import type { IncomingMessage } from "node:http";
import { SESSION_COOKIE_NAME, validateSessionCookie } from "./session.js";
import { config } from "../config.js";

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (config.AUTH_DISABLED) {
    next();
    return;
  }
  const raw = req.headers.cookie ? cookie.parse(req.headers.cookie)[SESSION_COOKIE_NAME] : undefined;
  if (!validateSessionCookie(raw)) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }
  next();
}

export function isAuthenticatedUpgradeRequest(req: IncomingMessage): boolean {
  if (config.AUTH_DISABLED) return true;
  const raw = req.headers.cookie ? cookie.parse(req.headers.cookie)[SESSION_COOKIE_NAME] : undefined;
  return validateSessionCookie(raw);
}
