import path from "node:path";
import type { ScanReport } from "@overlay/shared";
import { runCommand } from "./run-tool.js";
import { sendNtfyNotification } from "./ntfy-client.js";
import { notifyOpenClawIfConfigured } from "../openclaw/openclaw-webhook.js";
import { config } from "../config.js";

export function formatSummaryLine(report: ScanReport): string {
  const { critical, high, medium, low, info } = report.summary;
  const skipped = report.tools.filter((t) => t.status === "skipped").map((t) => t.tool);
  const parts = [`critical=${critical}`, `high=${high}`, `medium=${medium}`, `low=${low}`, `info=${info}`];
  if (skipped.length > 0) parts.push(`skipped=[${skipped.join(",")}]`);
  return parts.join(" ");
}

export async function notifyIfConfigured(report: ScanReport): Promise<void> {
  const { critical, high } = report.summary;
  if (critical === 0 && high === 0) return; // no push for an all-clear or low/medium/info-only night

  const title = `Overlay Sicherheitsscan: ${critical} kritisch, ${high} hoch`;
  const message =
    report.llmTriage?.status === "ok" && report.llmTriage.text
      ? report.llmTriage.text
      : `${formatSummaryLine(report)}\n\nDetails im "Sicherheit"-Tab von Overlay.`;

  if (config.NTFY_URL) {
    try {
      await sendNtfyNotification(config.NTFY_URL, title, message, critical > 0 ? "urgent" : "high");
    } catch (err) {
      // A failed push shouldn't fail the whole scan run — the report is still
      // saved and visible in the dashboard either way.
      console.error(`[overlay-security-scan] ntfy notification failed: ${(err as Error).message}`);
    }
  }

  // Additional, independent of ntfy — OpenClaw relays into whatever chat
  // apps that gateway is connected to.
  await notifyOpenClawIfConfigured(`${title}\n\n${message}`);
}

export async function chownReportsDirIfConfigured(): Promise<void> {
  const user = process.env.SECURITY_SCAN_CHOWN_USER;
  if (!user) return;
  const owner = process.env.SECURITY_SCAN_CHOWN_GROUP ? `${user}:${process.env.SECURITY_SCAN_CHOWN_GROUP}` : user;
  const reportsDir = path.join(process.cwd(), "data", "security-scans");
  try {
    await runCommand("chown", ["-R", owner, reportsDir], { timeoutMs: 30_000 });
  } catch (err) {
    console.error(`Warning: failed to chown ${reportsDir} to ${owner}: ${(err as Error).message}`);
  }
}
