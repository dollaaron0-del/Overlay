import dotenv from "dotenv";
import { z } from "zod";
import path from "node:path";
import fs from "node:fs";

// npm workspace scripts run with cwd set to server/, but the .env file lives
// at the repo root (per README/DEPLOYMENT.md: `cp .env.example .env`). Prefer
// a server/.env override if present, otherwise fall back to the repo root.
for (const candidate of [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "..", ".env")]) {
  if (fs.existsSync(candidate)) {
    dotenv.config({ path: candidate });
    break;
  }
}

const schema = z.object({
  BIND_ADDRESS: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().positive().default(4317),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  APPS_ROOT: z.string().min(1, "APPS_ROOT must be set"),
  SESSION_SECRET: z.string().min(16, "SESSION_SECRET must be set to a long random string"),
  ADMIN_USERNAME: z.string().min(1, "ADMIN_USERNAME must be set"),
  ADMIN_PASSWORD_HASH: z.string().min(1, "ADMIN_PASSWORD_HASH must be set (run: npm run set-password -w server)"),
  // The command spawned per-project in the terminal panel. Defaults to the real
  // Claude Code CLI; override to e.g. "bash" for local/sandbox testing of the
  // pty <-> WebSocket <-> xterm.js plumbing without a `claude` login available.
  CLAUDE_COMMAND: z.string().default("claude"),
  // Only consulted outside production: the Vite dev server runs on its own
  // port and proxies /api and /ws through to this backend, so the browser's
  // Origin header for a WebSocket upgrade is the dev server's origin, not
  // this backend's. In production the frontend is served by this same
  // process, so Origin always equals the request Host and this is unused.
  DEV_FRONTEND_ORIGIN: z.string().default("http://localhost:5173"),
  // Nightly security scan (see security/orchestrator.ts). All optional with
  // sane defaults — only relevant on the real server where the scan actually
  // runs as its own root-privileged systemd timer, not in this Node process.
  // Shared by both ClamAV and Trivy (both scan the same root filesystem target).
  FULL_SYSTEM_SCAN_PATH: z.string().default("/"),
  LYNIS_REPORT_PATH: z.string().default("/var/log/lynis-report.dat"),
  // Comma-separated list of hosts allowed to have listening sockets, on top
  // of loopback (always allowed). Empty means "just BIND_ADDRESS".
  SECURITY_SCAN_ALLOWED_HOSTS: z.string().default(""),
  // Advisory-only LLM triage over the already-computed findings, via a local
  // Ollama instance (see security/ollama-client.ts). Empty OLLAMA_MODEL means
  // "not configured" — the triage stage is then skipped, same as any other
  // scan tool that isn't installed. Never influences severities/counts.
  OLLAMA_BASE_URL: z.string().default("http://127.0.0.1:11434"),
  OLLAMA_MODEL: z.string().default(""),
  OLLAMA_TIMEOUT_MS: z.coerce.number().int().positive().default(10 * 60_000),
  // Optional push notification (ntfy.sh or self-hosted) when the nightly
  // scan finds anything critical/high. Empty = disabled. NOTE: ntfy.sh is a
  // public service — a finding summary sent to a public topic there is
  // visible to anyone who knows/guesses the topic name unless you self-host
  // ntfy or pick an unguessable topic (see docs/DEPLOYMENT.md).
  NTFY_URL: z.string().default(""),
  // Nightly backups via restic (server/src/backup/). Empty RESTIC_REPOSITORY
  // disables backups entirely — unlike the security scan, this runs as the
  // SAME unprivileged user as the main Overlay process (it only needs read
  // access to APPS_ROOT and its own data/, which that user already owns).
  RESTIC_REPOSITORY: z.string().default(""),
  RESTIC_PASSWORD: z.string().default(""),
  BACKUP_TIMEOUT_MS: z.coerce.number().int().positive().default(60 * 60_000),
  BACKUP_KEEP_DAILY: z.coerce.number().int().positive().default(7),
  BACKUP_KEEP_WEEKLY: z.coerce.number().int().positive().default(4),
  BACKUP_KEEP_MONTHLY: z.coerce.number().int().positive().default(6),
  // Per-project deploy button (projects/projects.routes.ts POST /:id/deploy).
  // Deploy scripts (git pull + install + build) can legitimately take a
  // while, hence the generous default.
  DEPLOY_TIMEOUT_MS: z.coerce.number().int().positive().default(10 * 60_000),
  // Per-message timeout for the "Ideen"-chat (server/src/ideachat/), which
  // invokes the real `claude` CLI headlessly (-p/--output-format json) with
  // read-only tool access to the chosen project. A single turn can involve
  // several tool calls (Read/Glob/Grep) before the model replies.
  IDEA_CHAT_TIMEOUT_MS: z.coerce.number().int().positive().default(5 * 60_000),
  // Optional two-tier local pre-filter in front of the real claude CLI call
  // above: every idea-chat message is tried against a fast/cheap local
  // Ollama model first, then a stronger local one, and only escalates to
  // Claude if a tier's model itself decides the request needs actual code
  // access. Meant for two separate local Ollama instances (e.g. one bound
  // to CPU/RAM-only, one to a GPU) — set OLLAMA_HOST to different ports
  // when starting each. Empty *_MODEL disables that tier (falls straight
  // through), same pattern as OLLAMA_MODEL above; both empty reproduces the
  // original Claude-only behavior exactly.
  IDEA_CHAT_OLLAMA_RAM_URL: z.string().default("http://127.0.0.1:11434"),
  IDEA_CHAT_OLLAMA_RAM_MODEL: z.string().default(""),
  IDEA_CHAT_OLLAMA_GPU_URL: z.string().default("http://127.0.0.1:11435"),
  IDEA_CHAT_OLLAMA_GPU_MODEL: z.string().default(""),
  IDEA_CHAT_OLLAMA_TIMEOUT_MS: z.coerce.number().int().positive().default(2 * 60_000),
  // Optional outgoing webhook to a self-hosted OpenClaw gateway
  // (https://openclaw.ai/), so critical scan findings, backup failures and
  // saved Ideenpläne also reach chat apps (Discord/Telegram/WhatsApp/etc.)
  // OpenClaw is connected to — in addition to ntfy, not instead of it. Empty
  // URL disables this entirely. The exact payload shape/auth header were
  // not verified against OpenClaw's primary docs (only reachable via
  // third-party sources) — see server/src/openclaw/openclaw-webhook.ts.
  OPENCLAW_WEBHOOK_URL: z.string().default(""),
  OPENCLAW_WEBHOOK_SECRET: z.string().default(""),
  // Token-authenticated automation API (/api/automation/*) — lets OpenClaw
  // (or any other script) start/stop/restart/deploy projects and trigger a
  // backup/scan, e.g. from a chat command. Deliberately separate from the
  // session-cookie auth the browser UI uses: a long-lived Bearer token
  // instead of a login. Empty = the whole /api/automation/* router 404s.
  AUTOMATION_TOKEN: z.string().default(""),
  // Token-authenticated inbound endpoint (/api/emmy/inbound) that OpenClaw
  // calls when the Emmy agent replies to a chat message sent via
  // sendEmmyChatMessage (server/src/openclaw/openclaw-webhook.ts) — the
  // other half of the two-way "Emmy" chat app. Deliberately a separate
  // token from AUTOMATION_TOKEN: that one lets a caller *act* on Overlay
  // (start/stop/deploy), this one only lets a caller *append a chat
  // message* — narrower blast radius if it ever leaks. Empty = the whole
  // /api/emmy/inbound router 404s, same as AUTOMATION_TOKEN above.
  EMMY_INBOUND_TOKEN: z.string().default(""),
  COOKIE_SECURE: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
});

function loadConfig() {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid configuration:");
    for (const issue of parsed.error.issues) {
      console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }
  const env = parsed.data;
  return {
    ...env,
    APPS_ROOT: path.resolve(env.APPS_ROOT),
    isProduction: env.NODE_ENV === "production",
  };
}

export const config = loadConfig();
export type Config = typeof config;
