/**
 * Minimal client for sending a push notification via ntfy (https://ntfy.sh
 * or a self-hosted instance) — see https://docs.ntfy.sh/publish/.
 *
 * NOTE: ntfy header values are technically restricted to ASCII by the HTTP
 * spec; non-ASCII text (e.g. German umlauts in the title) is percent-encoded
 * here per ntfy's documented workaround. This wasn't verified against a live
 * ntfy instance from this dev sandbox — check docs.ntfy.sh/publish/#e-mail-
 * notifications style header-encoding notes if titles show up garbled.
 */
export async function sendNtfyNotification(
  ntfyUrl: string,
  title: string,
  message: string,
  priority: "default" | "high" | "urgent" = "default",
): Promise<void> {
  const response = await fetch(ntfyUrl, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      Title: encodeURIComponent(title),
      Priority: priority,
      Tags: "warning",
    },
    body: message,
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`ntfy returned ${response.status}: ${body.slice(0, 300)}`);
  }
}
