import { Router } from "express";
import { config } from "../config.js";
import { getLatestReport, getReport, listReports } from "./report-store.js";
import { getScanProgress } from "./scan-progress-store.js";
import { listOllamaModels, modelIsInstalled, OllamaUnavailableError } from "./ollama-client.js";
import { runCommand } from "./run-tool.js";
import { appendAuditEntry } from "../audit/audit-log.js";

export const securityRouter = Router();

const OLLAMA_STATUS_TIMEOUT_MS = 5000; // a quick liveness ping, not the long nightly-triage timeout

// The scan itself needs root for full filesystem access (see orchestrator.ts /
// docs/SECURITY.md) and deliberately runs as a separate, root-privileged
// systemd unit — never inside this (intentionally unprivileged) web server
// process. A manual "run now" trigger therefore can't just call runScan()
// in-process (that would silently produce a degraded, permission-limited
// scan and undermine the whole privilege-separation model) — instead it
// asks systemd to start the real unit, via a narrowly scoped sudoers rule
// (see docs/DEPLOYMENT.md section 7.5) that allows nothing except this one
// command.
const SECURITY_SCAN_UNIT = "overlay-security-scan.service";

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

securityRouter.post("/scans/run", async (_req, res) => {
  try {
    const result = await runCommand("sudo", ["systemctl", "start", SECURITY_SCAN_UNIT], { timeoutMs: 15_000 });
    if (result.exitCode !== 0) {
      res.status(500).json({
        error: "trigger_failed",
        message: `sudo systemctl start ${SECURITY_SCAN_UNIT} fehlgeschlagen (exit ${result.exitCode}): ${result.stderr.slice(0, 500) || "siehe docs/DEPLOYMENT.md Abschnitt 7.5 (sudoers-Einrichtung)"}`,
      });
      return;
    }
    await appendAuditEntry({ type: "scan_triggered" });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "trigger_failed", message: (err as Error).message });
  }
});

// A file the running scan process writes to (see cli.ts / scan-progress-store.ts)
// — reading it needs no root, unlike the scan itself.
securityRouter.get("/scan-progress", async (_req, res) => {
  res.json(await getScanProgress());
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
