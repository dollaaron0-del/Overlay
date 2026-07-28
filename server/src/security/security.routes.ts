import { Router } from "express";
import { getLatestReport, getReport, listReports } from "./report-store.js";

export const securityRouter = Router();

securityRouter.get("/scans", async (_req, res) => {
  const reports = await listReports();
  res.json(reports);
});

securityRouter.get("/scans/latest", async (_req, res) => {
  const report = await getLatestReport();
  if (!report) {
    res.status(404).json({ error: "no_scans_yet" });
    return;
  }
  res.json(report);
});

securityRouter.get("/scans/:id", async (req, res) => {
  const report = await getReport(req.params.id);
  if (!report) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json(report);
});
