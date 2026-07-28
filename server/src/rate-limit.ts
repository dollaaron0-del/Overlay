import rateLimit from "express-rate-limit";

/**
 * A blanket safety net for all /api routes, on top of (not instead of) the
 * dedicated brute-force backoff on /api/login. This one just bounds how much
 * any single client can hammer the API in general — generous enough that
 * normal use (start/stop/restart clicks, file browsing) never gets close.
 */
export const apiRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
});
