import { config } from "../config.js";

/**
 * Sends a simple {"text": "..."} payload to a self-hosted OpenClaw gateway
 * (https://openclaw.ai/), which relays it to whatever messaging apps
 * (Discord/Telegram/WhatsApp/Slack/etc.) that instance is connected to.
 *
 * NOTE: OpenClaw's exact webhook payload shape and expected auth header
 * could not be verified against its primary documentation (only reachable
 * via third-party sources at the time this was written — see
 * docs/DEPLOYMENT.md). If your OpenClaw instance expects a different body
 * or header, adjust this function to match.
 */
export async function sendOpenClawNotification(webhookUrl: string, secret: string, text: string): Promise<void> {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
    },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`OpenClaw webhook returned ${response.status}: ${body.slice(0, 300)}`);
  }
}

/** Best-effort: a failed OpenClaw push must never fail the scan/backup/plan-save it's reporting on. */
export async function notifyOpenClawIfConfigured(text: string): Promise<void> {
  if (!config.OPENCLAW_WEBHOOK_URL) return;
  try {
    await sendOpenClawNotification(config.OPENCLAW_WEBHOOK_URL, config.OPENCLAW_WEBHOOK_SECRET, text);
  } catch (err) {
    console.error(`[openclaw] webhook notification failed: ${(err as Error).message}`);
  }
}
