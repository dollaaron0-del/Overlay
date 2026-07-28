import { Router } from "express";
import { listAuditEntries } from "./audit-log.js";

export const auditRouter = Router();

auditRouter.get("/", async (_req, res) => {
  res.json(await listAuditEntries());
});
