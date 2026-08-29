import { config } from "./config.js";

/**
 * State of the two model backends Emmy routes between, for the sidebar
 * "Modelle" widget. Deliberately tiny: which Claude CLI account is live, and
 * whether Gemini still has capacity — nothing else.
 *
 * Data source: the OpenClaw Gateway's bundled `admin-http-rpc` plugin
 * (POST /api/v1/admin/rpc), methods `models.authStatus` + `usage.status`.
 * That plugin is a full operator control-plane surface, so it is opt-in:
 * until `OPENCLAW_ADMIN_RPC_URL` / `OPENCLAW_ADMIN_RPC_TOKEN` are set (and the
 * plugin is enabled + the Emmy gateway restarted), this returns
 * `configured: false` and the widget renders a placeholder.
 *
 * Activation checklist (all on the Emmy gateway, port 18789):
 *   1. `openclaw plugins enable admin-http-rpc`
 *   2. `openclaw gateway restart`   (Aaron — needs gateway access)
 *   3. put the gateway operator token + `http://127.0.0.1:18789/api/v1/admin/rpc`
 *      into the Overlay `.env` as OPENCLAW_ADMIN_RPC_TOKEN / _URL
 *   4. `pm2 restart overlay`
 *
 * The exact response shapes of `models.authStatus` / `usage.status` were not
 * verified against a live gateway (plugin not yet enabled), so the parsing
 * below is best-effort and every field degrades to null rather than throwing.
 */
export interface ModelStatus {
  /** True once the admin RPC endpoint is configured and answered. */
  configured: boolean;
  claudeCli: {
    /** Account / auth-profile label, e.g. "claude-cli (Abo A)". */
    label: string | null;
    /** True if a usage window (5h / week) is exhausted. */
    limited: boolean | null;
    /** Short human detail, e.g. "5 h 69 % · Woche 35 %". */
    detail: string | null;
  };
  gemini: {
    /** True if Gemini still has quota headroom. */
    hasCapacity: boolean | null;
    detail: string | null;
  };
  /** Set when configured but the call failed. */
  error?: string;
}

const PLACEHOLDER: ModelStatus = {
  configured: false,
  claudeCli: { label: null, limited: null, detail: null },
  gemini: { hasCapacity: null, detail: null },
};

const CACHE_MS = 30_000;
let cache: { at: number; value: ModelStatus } | null = null;

interface RpcOk {
  ok: boolean;
  payload?: unknown;
  error?: { message?: string };
}

async function rpc(method: string): Promise<unknown> {
  const res = await fetch(config.OPENCLAW_ADMIN_RPC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(config.OPENCLAW_ADMIN_RPC_TOKEN
        ? { Authorization: `Bearer ${config.OPENCLAW_ADMIN_RPC_TOKEN}` }
        : {}),
    },
    body: JSON.stringify({ method, params: {} }),
    signal: AbortSignal.timeout(5000),
  });
  const json = (await res.json()) as RpcOk;
  if (!json.ok) throw new Error(json.error?.message || `${method} failed (${res.status})`);
  return json.payload;
}

/** Pull `{ provider, displayName, windows: [{ label, usedPercent }] }[]` out of a usage.status payload. */
function readUsageProviders(payload: unknown): Array<{
  provider?: string;
  displayName?: string;
  windows?: Array<{ label?: string; usedPercent?: number }>;
}> {
  if (payload && typeof payload === "object") {
    const p = payload as Record<string, unknown>;
    const providers = (p.providers ?? (p.usage as Record<string, unknown> | undefined)?.providers) as unknown;
    if (Array.isArray(providers)) return providers as never;
  }
  return [];
}

function summariseWindows(windows: Array<{ label?: string; usedPercent?: number }> = []): {
  limited: boolean;
  detail: string;
} {
  const parts = windows
    .filter((w) => typeof w.usedPercent === "number")
    .map((w) => `${w.label ?? "?"} ${w.usedPercent} %`);
  const limited = windows.some((w) => typeof w.usedPercent === "number" && (w.usedPercent as number) >= 100);
  return { limited, detail: parts.join(" · ") };
}

export async function getModelStatus(): Promise<ModelStatus> {
  if (!config.OPENCLAW_ADMIN_RPC_URL) return PLACEHOLDER;
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;

  const value: ModelStatus = {
    configured: true,
    claudeCli: { label: null, limited: null, detail: null },
    gemini: { hasCapacity: null, detail: null },
  };

  try {
    const [authStatus, usage] = await Promise.all([
      rpc("models.authStatus").catch(() => null),
      rpc("usage.status").catch(() => null),
    ]);

    // models.authStatus: shape unverified — look for an entry that names a
    // claude-cli / anthropic auth profile and treat its identifier as the label.
    if (authStatus && typeof authStatus === "object") {
      const entries = Array.isArray(authStatus)
        ? (authStatus as Array<Record<string, unknown>>)
        : Array.isArray((authStatus as Record<string, unknown>).providers)
          ? ((authStatus as Record<string, unknown>).providers as Array<Record<string, unknown>>)
          : [];
      const claude = entries.find((e) => {
        const s = JSON.stringify(e).toLowerCase();
        return s.includes("claude-cli") || s.includes("anthropic");
      });
      if (claude) {
        value.claudeCli.label =
          (claude.label as string) ||
          (claude.account as string) ||
          (claude.profile as string) ||
          (claude.id as string) ||
          "Claude CLI";
      }
    }

    const providers = readUsageProviders(usage);
    const claudeUsage = providers.find((p) =>
      `${p.provider ?? ""} ${p.displayName ?? ""}`.toLowerCase().includes("anthropic") ||
      `${p.provider ?? ""} ${p.displayName ?? ""}`.toLowerCase().includes("claude"),
    );
    if (claudeUsage) {
      const { limited, detail } = summariseWindows(claudeUsage.windows);
      value.claudeCli.limited = limited;
      value.claudeCli.detail = detail || null;
      if (!value.claudeCli.label) value.claudeCli.label = claudeUsage.displayName ?? "Claude CLI";
    }

    const geminiUsage = providers.find((p) =>
      `${p.provider ?? ""} ${p.displayName ?? ""}`.toLowerCase().includes("gemini") ||
      `${p.provider ?? ""} ${p.displayName ?? ""}`.toLowerCase().includes("google"),
    );
    if (geminiUsage) {
      const { limited, detail } = summariseWindows(geminiUsage.windows);
      value.gemini.hasCapacity = !limited;
      value.gemini.detail = detail || null;
    }
  } catch (err) {
    value.error = (err as Error).message;
  }

  cache = { at: Date.now(), value };
  return value;
}
