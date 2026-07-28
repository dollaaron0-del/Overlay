import { Router } from "express";
import { config } from "../config.js";
import { getLatestReport, getReport, listReports } from "./report-store.js";
import { listOllamaModels, modelIsInstalled, OllamaUnavailableError } from "./ollama-client.js";

export const securityRouter = Router();

const OLLAMA_STATUS_TIMEOUT_MS = 5000; // a quick liveness ping, not the long nightly-triage timeout

securityRouter.get("/ollama-status", async (_req, res) => {
  if (!config.OLLAMA_MODEL) {
    res.json({ configured: false });
    return;
  }
  try {
    const models = await listOllamaModels(config.OLLAMA_BASE_URL, OLLAMA_STATUS_TIMEOUT_MS);
    res.json({
      configured: true,
      reachable: true,
      model: config.OLLAMA_MODEL,
      modelInstalled: modelIsInstalled(config.OLLAMA_MODEL, models),
    });
  } catch (err) {
    res.json({
      configured: true,
      reachable: false,
      model: config.OLLAMA_MODEL,
      error: err instanceof OllamaUnavailableError ? "unreachable" : (err as Error).message,
    });
  }
});

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
