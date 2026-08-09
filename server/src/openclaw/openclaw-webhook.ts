import { config } from "../config.js";

/**
 * NOTE: OpenClaw's exact webhook payload shape and expected auth header
 * could not be verified against its primary documentation (only reachable
 * via third-party sources at the time this was written — see
 * docs/DEPLOYMENT.md). If your OpenClaw instance expects a different body
 * or header, adjust this function to match.
 */
async function postToOpenClaw(webhookUrl: string, secret: string, payload: Record<string, unknown>): Promise<void> {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`OpenClaw webhook returned ${response.status}: ${body.slice(0, 300)}`);
  }
}

/**
 * Sends a simple {"text": "..."} payload to a self-hosted OpenClaw gateway
 * (https://openclaw.ai/), which relays it to whatever messaging apps
 * (Discord/Telegram/WhatsApp/Slack/etc.) that instance is connected to.
 */
export async function sendOpenClawNotification(webhookUrl: string, secret: string, text: string): Promise<void> {
  await postToOpenClaw(webhookUrl, secret, { text });
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

/**
 * Same gateway, but marked `thread: "emmy"` so OpenClaw (or a routing rule
 * on it) can tell this apart from the plain one-line notifications above —
 * this is a two-way chat turn addressed to the Emmy agent, not a fire-and-
 * forget alert. Unlike notifyOpenClawIfConfigured, this is NOT best-effort:
 * emmy.routes.ts needs to know whether the message actually left, to tell
 * the sender in the UI (see emmy-store.ts — the message stays saved either
 * way, only the "did it send" signal differs).
 */
export async function sendEmmyChatMessage(text: string): Promise<void> {
  if (!config.OPENCLAW_WEBHOOK_URL) {
    throw new Error("OPENCLAW_WEBHOOK_URL ist nicht konfiguriert");
  }
  await postToOpenClaw(config.OPENCLAW_WEBHOOK_URL, config.OPENCLAW_WEBHOOK_SECRET, { text, thread: "emmy" });
}

/**
 * Drives one isolated OpenClaw agent turn via the Gateway's `hooks` endpoint
 * (POST /hooks/agent). Unlike sendEmmyChatMessage above (the legacy webhook-
 * plugin path), this binds the turn to a per-chat `sessionKey`, so each Emmy
 * task chat keeps its own isolated context. The reply does NOT come back
 * through this call — the agent turn posts its answer to /api/emmy/inbound
 * itself (the message text tells it how, including the chatId), which is why
 * this is fire-and-return: a 200 here only means the turn was accepted.
 */
export async function sendEmmyHookTurn(sessionKey: string, name: string, message: string): Promise<void> {
  if (!config.OPENCLAW_HOOK_URL) {
    throw new Error("OPENCLAW_HOOK_URL ist nicht konfiguriert");
  }
  await postToOpenClaw(config.OPENCLAW_HOOK_URL, config.OPENCLAW_HOOK_TOKEN, {
    message,
    sessionKey,
    name,
    deliver: false,
  });
}
