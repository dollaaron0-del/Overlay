import { Router } from "express";
import { config } from "../config.js";
import { getRemoteUser } from "./auth.middleware.js";

export const authRouter = Router();

// Bootstrap check the frontend calls on load, before it knows whether it's
// authenticated at all — so this route sits outside requireAuth. "Who is
// logged in" is answered entirely by Caddy's forward_auth outcome: if this
// process is reachable and carries a Remote-User header, Authelia already
// approved a two_factor session upstream (see docs/DEPLOYMENT.md section 9).
authRouter.get("/session", (req, res) => {
  if (config.AUTH_DISABLED) {
    res.json({ authenticated: true, user: null });
    return;
  }
  const user = getRemoteUser(req);
  res.json({ authenticated: user !== undefined, user: user ?? null });
});
