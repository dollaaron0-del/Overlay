import { Router } from "express";
import { getSystemStats } from "./system-stats.js";

export const systemRouter = Router();

systemRouter.get("/stats", async (_req, res) => {
  res.json(await getSystemStats());
});
