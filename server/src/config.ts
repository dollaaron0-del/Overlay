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
  // Overlay has no login of its own: every route trusts the Remote-User
  // header that Caddy's forward_auth sets once Authelia has approved a
  // two_factor session (see docs/DEPLOYMENT.md section 9 and
  // auth/auth.middleware.ts). AUTH_DISABLED skips that header check
  // entirely — only defensible for local dev, when no Authelia/Caddy sits
  // in front at all. With Overlay reachable directly, this hands the whole
  // dashboard, every project terminal and this machine's .env to anyone who
  // can reach the port, with zero authentication. Empty/unset = normal
  // behaviour, which is what every fresh install gets.
  AUTH_DISABLED: z
    .string()
    .default("")
    .transform((v) => v === "1" || v.toLowerCase() === "true"),
  // The command spawned per-project in the terminal panel. Defaults to the real
  // Claude Code CLI; override to e.g. "bash" for local/sandbox testing of the
  // pty <-> WebSocket <-> xterm.js plumbing without a `claude` login available.
  CLAUDE_COMMAND: z.string().default("claude"),
  // Where the *real* Claude Code login lives (the ".claude" dir containing
  // .credentials.json), so every project's isolated terminal home can link
  // against it (see pty/claude-home.ts). Defaults to this process's own home
  // dir — fine when Overlay runs as the same Linux user that ran `claude
  // login`, wrong when Overlay runs as its own service user (e.g. `overlay`)
  // while the subscription login was done as a different user (e.g. `aaron`
  // over SSH): os.homedir() then points at an empty .claude nobody ever
  // logged into. Empty/unset = fall back to this process's own home dir.
  CLAUDE_SHARED_HOME: z.string().default(""),
  // A fine-grained GitHub PAT (scope it to just "Contents: Read and write" on
  // the repos Overlay should be able to push to) that every sandboxed project
  // session can use to `git push` its own branches — same shared-across-all-
  // projects trust model as CLAUDE_SHARED_HOME above, so keep it scoped to
  // only the repos this Overlay instance is trusted to modify. Passed in as
  // GH_TOKEN (see pty/git-credentials.ts); paired with git's credential
  // helper pointing at `gh`, so no `gh auth login` state is ever needed inside
  // a sandbox. Empty/unset = today's behaviour: a session can prepare commits,
  // but pushing needs a manual step from outside any sandbox.
  GIT_SANDBOX_PUSH_TOKEN: z.string().default(""),
  // Runs every project terminal inside a bubblewrap sandbox that can only see
  // that project (see pty/sandbox.ts). On by default: without it, a session
  // opened for one project can read every other project and this
  // installation's own .env. Set to false only if bubblewrap cannot be
  // installed — the terminal then runs with the full rights of the service
  // user, as it did before.
  TERMINAL_SANDBOX: z
    .string()
    .default("true")
    .transform((v) => v !== "false"),
  // Shell spawned for the host terminal (a second, deliberately unsandboxed
  // pty onto this machine itself — see pty/host-terminal.manager.ts), so it
  // can sit open next to a project's terminal for commands that don't belong
  // to any one project (systemctl, journalctl, disk usage, ...). Unlike the
  // per-project terminal above, this always runs with the full rights of the
  // Overlay service user; it exists specifically to reach outside a project
  // sandbox, so wrapping it in one would defeat the point. It is reachable by
  // anyone who can reach this app itself, i.e. anyone Overlay's own auth (or
  // AUTH_DISABLED's front proxy) already lets in — same trust boundary as
  // every other route. Empty/unset = fall back to $SHELL, then /bin/bash,
  // then /bin/sh — skipping any of those that is a refusing shell
  // (/usr/sbin/nologin, /bin/false), which is exactly what $SHELL is for
  // this hardened service user. See resolveHostShell() for why.
  HOST_TERMINAL_SHELL: z.string().default(""),
  // Working directory the host terminal starts in. Empty/unset = this
  // process's own home directory, or / when that does not exist.
  HOST_TERMINAL_CWD: z.string().default(""),
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
  // OpenClaw Gateway `hooks` endpoint (POST /hooks/agent) used by the Emmy
  // multi-chat app to drive one isolated agent turn per chat message, bound
  // to a per-chat sessionKey. Separate from OPENCLAW_WEBHOOK_URL above (the
  // legacy webhook-plugin path, which does not support per-chat sessions).
  // Token is the Gateway's `hooks.token`. Empty = sending chat messages fails
  // with a clear "nicht konfiguriert" error, but the message stays saved.
  OPENCLAW_HOOK_URL: z.string().default(""),
  OPENCLAW_HOOK_TOKEN: z.string().default(""),
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
  // Cross-conversation memory for Emmy (server/src/emmy/emmy-memory.ts): every
  // message, in every chat — including deleted ones, which emmy-store.ts keeps
  // in its archive — is embedded via a local Ollama model and cosine-matched
  // against new messages, so Emmy can recall something discussed in a
  // different chat without it being repasted. Same optional/best-effort
  // pattern as OLLAMA_MODEL above: empty EMMY_MEMORY_EMBEDDING_MODEL disables
  // this tier entirely (no network call is even attempted), leaving only the
  // always-on same-chat recent-history context. Suggest a multilingual model
  // (e.g. "bge-m3") since Emmy's own prompts are German.
  EMMY_MEMORY_OLLAMA_URL: z.string().default("http://127.0.0.1:11434"),
  EMMY_MEMORY_EMBEDDING_MODEL: z.string().default(""),
  // Optional on top of the above: short image captions (via a vision model,
  // e.g. "llava") folded into a message's indexed text, so a photo becomes
  // findable by what's in it, not just its filename. Empty = attachments are
  // still indexed by filename alone. Vision inference is much slower than
  // embedding a short text, hence the separate, longer timeout.
  EMMY_MEMORY_VISION_MODEL: z.string().default(""),
  EMMY_MEMORY_EMBEDDING_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  EMMY_MEMORY_VISION_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  // Optional: when the general chat is reset, have a local model write the
  // one-paragraph "what was this about" digest in prose (in Emmy's voice)
  // instead of the mechanical bullet list. Empty = keep the mechanical digest
  // (buildConversationDigest). Runs entirely on local Ollama — no gateway
  // round-trip, no Claude/Gemini quota — and falls straight back to the
  // mechanical digest on any failure, so memory is never lost. Suggest a
  // capable instruct model with decent German, e.g. "qwen2.5:7b-instruct".
  EMMY_MEMORY_DIGEST_MODEL: z.string().default(""),
  EMMY_MEMORY_DIGEST_TIMEOUT_MS: z.coerce.number().int().positive().default(90_000),
  // How many cross-chat memory hits (top-K by cosine similarity) get added to
  // a prompt, and the minimum similarity score for a hit to count at all.
  EMMY_MEMORY_TOP_K: z.coerce.number().int().positive().default(6),
  EMMY_MEMORY_MIN_SCORE: z.coerce.number().min(0).max(1).default(0.55),
  // Model recurring checks run on (emmy-scheduler.ts runRecurringTasksTick).
  // Checks are frequent and lightweight, so they go to Gemini to spare the
  // Claude subscription. Empty = stay on the gateway default (Claude).
  EMMY_RECURRING_MODEL: z.string().default(""),
  // Model the recurring-tasks scheduler retries a check with if the primary
  // (EMMY_RECURRING_MODEL, or the gateway default) turn fails outright — e.g.
  // that model's usage limit is exhausted. Pick a *different provider* so the
  // retry can actually succeed. Empty disables the retry; the check is just
  // marked failed and picked up again next tick.
  EMMY_RECURRING_FALLBACK_MODEL: z.string().default(""),
  // Model the *research gathering* phase runs on (category "research", before
  // it flips to "discussion"). 2026-08-31: switched from a bare Gemini Flash
  // turn (hallucinated when a tool/fetch failed instead of saying so — see
  // memory/overlay-research-source-bound.md) to a Claude Haiku *orchestrator*
  // that spawns EMMY_RESEARCH_WORKER_MODEL sub-agents for the bulk reading.
  // Haiku runs through the same anthropic:claude-cli OAuth profile as every
  // other Claude model on this gateway (confirmed via `models` — no separate
  // API-key profile exists here), so it DOES count against the weekly
  // subscription limit; it's just the cheapest tier, and most of the token
  // volume is meant to go to the Gemini worker sub-agents instead. Unlike
  // Flash, it doesn't paper over a blocked source with an invented finding.
  // The discussion phase, normal chat and recurring checks stay on the
  // gateway default, where judgement and tone matter most. Empty disables
  // the split (everything stays on the default model). See turnModelFor().
  EMMY_RESEARCH_MODEL: z.string().default(""),
  // Cheap worker model the research orchestrator (EMMY_RESEARCH_MODEL) is
  // told to spawn sub-agents on for pure reading/extraction of already-
  // fetched source text (transcripts, page dumps, code) — the token-heavy,
  // judgement-light part. Workers get pasted text, not URLs, so a model
  // without tool-calling (e.g. a Flash-Lite tier) is fine here on purpose.
  // Empty: the prompt tells the orchestrator to read everything itself.
  EMMY_RESEARCH_WORKER_MODEL: z.string().default(""),
  // Research fallback chain, tried in order when EMMY_RESEARCH_MODEL (or the
  // previous tier) fails outright — e.g. the model stalls a long agentic
  // research turn into a backoff loop until the gateway timeout kills it, and
  // the turn never calls /api/emmy/inbound back. 2026-08-31: two tiers by
  // design (Aaron's call, overriding the 2026-08-30 "keep it Claude-free"
  // decision): tier 1 = the *other* Claude subscription (claude-cli2), so a
  // Claude orchestrator keeps driving/watching the research as long as either
  // account has quota; tier 2 = Gemini, a bare worker turn with no Claude
  // supervision, only reached once both Claude accounts are exhausted. Each
  // tier disabled by leaving it empty. Used by spinOffResearchTask + the
  // scheduler's research-due and stalled-research watchdog ticks — see
  // sendEmmyHookTurnWithFallback (openclaw-webhook.ts) for the chain logic.
  EMMY_RESEARCH_FALLBACK_MODEL: z.string().default(""),
  EMMY_RESEARCH_FALLBACK_MODEL_2: z.string().default(""),
  // How many of the current chat's own recent messages ride along on every
  // turn, independent of the embedding tier above — this alone is what fixes
  // Emmy forgetting mid-task even with no Ollama configured at all.
  EMMY_MEMORY_RECENT_MESSAGES: z.coerce.number().int().positive().default(10),
  // Reverse-proxy target for each program's full UI — the Overlay serves it
  // same-origin under /x/<id>/ so the sidebar dashboard windows can iframe it
  // from any device (see programs.proxy.ts). Defaults are the documented local
  // ports (Aktien: Streamlit; KI-Nachhilfe: the v276 Nachhilfelehrer app).
  // Streamlit serves under /x/aktien via --server.baseUrlPath; the Nachhilfe
  // app serves at "/" and the proxy strips the /x/ki-nachhilfe prefix.
  AKTIEN_APP_URL: z.string().default("http://127.0.0.1:8503"),
  KI_NACHHILFE_APP_URL: z.string().default("http://127.0.0.1:3000"),
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
