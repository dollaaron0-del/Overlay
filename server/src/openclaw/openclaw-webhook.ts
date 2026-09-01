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
export async function sendEmmyHookTurn(sessionKey: string, name: string, message: string, model?: string): Promise<void> {
  if (!config.OPENCLAW_HOOK_URL) {
    throw new Error("OPENCLAW_HOOK_URL ist nicht konfiguriert");
  }
  await postToOpenClaw(config.OPENCLAW_HOOK_URL, config.OPENCLAW_HOOK_TOKEN, {
    message,
    sessionKey,
    name,
    deliver: false,
    ...(model ? { model } : {}),
  });
}

/**
 * sendEmmyHookTurn with a one-shot model fallback: if the primary call throws
 * (the gateway rejected the turn outright — usage limit, bad model id, network
 * blip), retry once on `fallbackModel`. A 200 still only means "accepted", not
 * "answered" — a turn that dies mid-run without calling /api/emmy/inbound back
 * is caught by the stalled-research watchdog, not here. Returns which model the
 * accepted turn went out on (or undefined if it ran on the gateway default),
 * plus how many fallback tiers were exhausted, so the caller can log/track it.
 *
 * `fallbackModels` is tried in order (2026-08-31: research went from a single
 * fallback to a chain — Abo 2 (claude-cli2) first, so a Claude orchestrator is
 * still driving/watching the research as long as ANY Claude account has quota
 * left; only once both are exhausted does it drop to a bare Gemini worker
 * turn with no Claude supervision). Empty/undefined entries and entries equal
 * to a model already tried are skipped, not counted as a wasted attempt.
 */
export async function sendEmmyHookTurnWithFallback(
  sessionKey: string,
  name: string,
  message: string,
  primaryModel: string | undefined,
  fallbackModels: (string | undefined) | (string | undefined)[],
): Promise<{ usedFallback: boolean; model: string | undefined; fallbackTier: number }> {
  const chain = (Array.isArray(fallbackModels) ? fallbackModels : [fallbackModels]).filter(
    (m): m is string => !!m,
  );
  const tried = new Set<string | undefined>([primaryModel || undefined]);
  let lastErr: unknown;
  try {
    await sendEmmyHookTurn(sessionKey, name, message, primaryModel || undefined);
    return { usedFallback: false, model: primaryModel || undefined, fallbackTier: 0 };
  } catch (err) {
    lastErr = err;
  }
  for (let i = 0; i < chain.length; i++) {
    const model = chain[i];
    if (tried.has(model)) continue;
    tried.add(model);
    console.error(
      `[openclaw] hook turn for ${sessionKey} failed on ${
        i === 0 ? `primary model ${primaryModel ?? "(default)"}` : `fallback tier ${i} (${chain[i - 1]})`
      }, retrying with fallback tier ${i + 1} (${model}): ${(lastErr as Error).message}`,
    );
    try {
      await sendEmmyHookTurn(sessionKey, name, message, model);
      return { usedFallback: true, model, fallbackTier: i + 1 };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}
