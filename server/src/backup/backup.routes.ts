import { Router } from "express";
import { config } from "../config.js";
import { getLatestBackupSummary, listBackupSummaries } from "./backup-status-store.js";

export const backupRouter = Router();

backupRouter.get("/status", async (_req, res) => {
  if (!config.RESTIC_REPOSITORY) {
    res.json({ configured: false });
    return;
  }
  const latest = await getLatestBackupSummary();
  res.json({ configured: true, latest: latest ?? null });
});

backupRouter.get("/history", async (_req, res) => {
  const summaries = await listBackupSummaries();
  res.json(summaries);
});
