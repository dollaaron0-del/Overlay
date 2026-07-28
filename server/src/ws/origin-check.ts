import type { IncomingMessage } from "node:http";
import { config } from "../config.js";

/**
 * Defense-in-depth alongside the auth-cookie check: rejects WebSocket
 * upgrades whose Origin doesn't match the host actually being connected to.
 * Not the primary defense (Tailscale-only network reachability + the
 * SameSite=Lax session cookie already do most of the work), but cheap and
 * catches e.g. a malicious page loaded in another tab trying to open a
 * cross-site WebSocket using a browser's ambient cookie jar.
 */
export function isAllowedOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  // Non-browser clients (our own scripts, future CLI tooling) legitimately
  // don't send an Origin header at all; the auth cookie check still applies.
  if (!origin) return true;

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }

  if (originHost === req.headers.host) return true;
  if (!config.isProduction && origin === config.DEV_FRONTEND_ORIGIN) return true;
  return false;
}
