import rateLimit from "express-rate-limit";

/**
 * A blanket safety net for all /api routes (login brute-force protection is
 * Authelia's job now, not Overlay's). This just bounds how much any single
 * client can hammer the API in general — generous enough that normal use
 * (start/stop/restart clicks, file browsing) never gets close.
 */
export const apiRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
});
