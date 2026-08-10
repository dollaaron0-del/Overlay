import { Router } from "express";
import * as cookie from "cookie";
import { z } from "zod";
import { config } from "../config.js";
import { appendAuditEntry } from "../audit/audit-log.js";
import { verifyPassword } from "./password.js";
import { requireAuth } from "./auth.middleware.js";
import {
  createSession,
  destroySessionCookie,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  validateSessionCookie,
} from "./session.js";

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

// Simple in-memory backoff against brute-force login attempts (single-user app).
const failedAttempts = new Map<string, { count: number; nextAllowedAt: number }>();

function backoffMs(count: number): number {
  return Math.min(30_000, 500 * 2 ** count);
}

export const authRouter = Router();

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request" });
    return;
  }

  const ip = req.ip ?? "unknown";
  const attempt = failedAttempts.get(ip);
  if (attempt && Date.now() < attempt.nextAllowedAt) {
    res.status(429).json({ error: "too_many_attempts" });
    return;
  }

  const { username, password } = parsed.data;
  const validUsername = username === config.ADMIN_USERNAME;
  const validPassword = await verifyPassword(password, config.ADMIN_PASSWORD_HASH);

  if (!validUsername || !validPassword) {
    const count = (attempt?.count ?? 0) + 1;
    failedAttempts.set(ip, { count, nextAllowedAt: Date.now() + backoffMs(count) });
    await appendAuditEntry({ type: "login_failed", actor: ip, detail: username });
    res.status(401).json({ error: "invalid_credentials" });
    return;
  }

  failedAttempts.delete(ip);
  await appendAuditEntry({ type: "login", actor: username });
  const signedSessionId = createSession();
  res.setHeader(
    "Set-Cookie",
    cookie.serialize(SESSION_COOKIE_NAME, signedSessionId, {
      httpOnly: true,
      secure: config.COOKIE_SECURE,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
    }),
  );
  res.json({ ok: true });
});

authRouter.post("/logout", async (req, res) => {
  const raw = req.headers.cookie ? cookie.parse(req.headers.cookie)[SESSION_COOKIE_NAME] : undefined;
  destroySessionCookie(raw);
  await appendAuditEntry({ type: "logout" });
  res.setHeader(
    "Set-Cookie",
    cookie.serialize(SESSION_COOKIE_NAME, "", {
      httpOnly: true,
      secure: config.COOKIE_SECURE,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    }),
  );
  res.json({ ok: true });
});

authRouter.get("/session", (req, res) => {
  if (config.AUTH_DISABLED) {
    res.json({ authenticated: true });
    return;
  }
  const raw = req.headers.cookie ? cookie.parse(req.headers.cookie)[SESSION_COOKIE_NAME] : undefined;
  res.json({ authenticated: validateSessionCookie(raw) });
});

const verifyPasswordSchema = z.object({ password: z.string().min(1) });

// Backs the client-side inactivity lock screen (see os/LockScreen.tsx):
// re-checks the password without creating a new session or rotating the
// cookie — the existing session stays valid the whole time, this is only a
// client-side gate. Requires an *existing* valid session (unlike /login),
// and shares the same brute-force backoff bucket since it's the same
// credential being guessed from the same IP.
authRouter.post("/verify-password", requireAuth, async (req, res) => {
  if (config.AUTH_DISABLED) {
    res.json({ ok: true });
    return;
  }
  const parsed = verifyPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request" });
    return;
  }

  const ip = req.ip ?? "unknown";
  const attempt = failedAttempts.get(ip);
  if (attempt && Date.now() < attempt.nextAllowedAt) {
    res.status(429).json({ error: "too_many_attempts" });
    return;
  }

  const valid = await verifyPassword(parsed.data.password, config.ADMIN_PASSWORD_HASH);
  if (!valid) {
    const count = (attempt?.count ?? 0) + 1;
    failedAttempts.set(ip, { count, nextAllowedAt: Date.now() + backoffMs(count) });
    await appendAuditEntry({ type: "unlock_failed", actor: ip });
    res.status(401).json({ error: "invalid_password" });
    return;
  }

  failedAttempts.delete(ip);
  res.json({ ok: true });
});
