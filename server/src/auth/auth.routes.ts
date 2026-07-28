import { Router } from "express";
import * as cookie from "cookie";
import { z } from "zod";
import { config } from "../config.js";
import { verifyPassword } from "./password.js";
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
    res.status(401).json({ error: "invalid_credentials" });
    return;
  }

  failedAttempts.delete(ip);
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

authRouter.post("/logout", (req, res) => {
  const raw = req.headers.cookie ? cookie.parse(req.headers.cookie)[SESSION_COOKIE_NAME] : undefined;
  destroySessionCookie(raw);
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
  const raw = req.headers.cookie ? cookie.parse(req.headers.cookie)[SESSION_COOKIE_NAME] : undefined;
  res.json({ authenticated: validateSessionCookie(raw) });
});
