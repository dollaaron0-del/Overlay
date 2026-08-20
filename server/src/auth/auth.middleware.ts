import type { NextFunction, Request, Response } from "express";
import type { IncomingMessage } from "node:http";
import { config } from "../config.js";

// Set by Caddy's forward_auth (copy_headers Remote-User ...) once Authelia
// has approved a two_factor session — see docs/DEPLOYMENT.md section 9 and
// deploy/caddy/Caddyfile. Node lowercases incoming header names.
const REMOTE_USER_HEADER = "remote-user";

function remoteUser(headers: IncomingMessage["headers"]): string | undefined {
  const value = headers[REMOTE_USER_HEADER];
  const single = Array.isArray(value) ? value[0] : value;
  return single && single.length > 0 ? single : undefined;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (config.AUTH_DISABLED) {
    next();
    return;
  }
  if (!remoteUser(req.headers)) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }
  next();
}

export function isAuthenticatedUpgradeRequest(req: IncomingMessage): boolean {
  if (config.AUTH_DISABLED) return true;
  return remoteUser(req.headers) !== undefined;
}

export function getRemoteUser(req: Request): string | undefined {
  return remoteUser(req.headers);
}
