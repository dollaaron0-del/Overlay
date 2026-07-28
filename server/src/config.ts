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
