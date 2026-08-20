import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { EmmyChat } from "@overlay/shared";

// config.ts (OPENCLAW_HOOK_URL etc.) is a frozen singleton evaluated at
// first import, and emmy-store.ts caches its JSON store in memory once per
// process — same reasoning as emmy-store.test.ts and openclaw-webhook.test.ts
// for why everything below is a dynamic import after chdir + env setup, and
// why the fixture chats are written straight to disk BEFORE that first
// import: it lets each fixture carry an exact, hand-picked createdAt/
// lastRecurringCheckAt without waiting on real time to pass.
let tmpCwd: string;
let originalCwd: string;
let store: typeof import("./emmy-store.js");
let scheduler: typeof import("./emmy-scheduler.js");
let auditLog: typeof import("../audit/audit-log.js");
let mockServer: http.Server;
let receivedSessionKeys: string[];
let receivedMessagesByChatId: Record<string, string>;

// A designated sessionKey the mock OpenClaw gateway rejects with 500, to
// exercise the "gateway down" path without needing a second process/env.
const FAILING_CHAT_ID = "gateway-down-recurring";
const RESEARCH_FAILING_CHAT_ID = "gateway-down-research-due";

const HOUR_MS = 3_600_000;

before(async () => {
  receivedSessionKeys = [];
  receivedMessagesByChatId = {};
  mockServer = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const parsed = JSON.parse(body) as { sessionKey: string; message: string };
      receivedSessionKeys.push(parsed.sessionKey);
      // sessionKey is "agent:main:overlay:<chatId>" (see sessionKeyFor in emmy-turn-message.ts).
      const chatId = parsed.sessionKey.replace("agent:main:overlay:", "");
      receivedMessagesByChatId[chatId] = parsed.message;
      if (
        parsed.sessionKey === `agent:main:overlay:${FAILING_CHAT_ID}` ||
        parsed.sessionKey === `agent:main:overlay:${RESEARCH_FAILING_CHAT_ID}`
      ) {
        res.writeHead(500);
        res.end("gateway unreachable");
        return;
      }
      res.writeHead(200);
      res.end("ok");
    });
  });
  await new Promise<void>((resolve) => mockServer.listen(0, "127.0.0.1", resolve));
  const address = mockServer.address();
  if (!address || typeof address === "string") throw new Error("expected a bound TCP address");
  const hookUrl = `http://127.0.0.1:${address.port}/hooks/agent`;

  originalCwd = process.cwd();
  tmpCwd = await fs.mkdtemp(path.join(os.tmpdir(), "overlay-emmy-scheduler-test-"));
  process.chdir(tmpCwd);

  process.env.APPS_ROOT = path.join(tmpCwd, "apps-root");
  process.env.SESSION_SECRET = "test-session-secret-not-for-prod";
  process.env.ADMIN_USERNAME = "admin";
  process.env.ADMIN_PASSWORD_HASH = "$2b$04$0000000000000000000000000000000000000000000000000000";
  process.env.OPENCLAW_HOOK_URL = hookUrl;
  process.env.OPENCLAW_HOOK_TOKEN = "test-hook-token";
  process.env.EMMY_INBOUND_TOKEN = "test-inbound-token";

  const now = Date.now();
  const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString();

  function chat(overrides: Partial<EmmyChat> & Pick<EmmyChat, "id">): EmmyChat {
    return {
      kind: "task",
      title: overrides.id,
      status: "open",
      createdAt: iso(-30 * HOUR_MS),
      updatedAt: iso(-30 * HOUR_MS),
      category: "recurring",
      categorySource: "auto",
      intervalHours: 6,
      ...overrides,
    };
  }

  const chats: EmmyChat[] = [
    // Interval elapsed since the last check -> due.
    chat({ id: "due-recurring", lastRecurringCheckAt: iso(-7 * HOUR_MS) }),
    // Interval not yet elapsed -> not due.
    chat({ id: "not-due-recurring", lastRecurringCheckAt: iso(-2 * HOUR_MS) }),
    // Never checked before; falls back to createdAt, which is old enough -> due.
    chat({ id: "first-run-recurring", createdAt: iso(-7 * HOUR_MS), updatedAt: iso(-7 * HOUR_MS) }),
    // Otherwise due, but marked done -> ignored.
    chat({ id: "done-recurring", status: "done", lastRecurringCheckAt: iso(-7 * HOUR_MS) }),
    // Wrong category, even though a dueAt/interval-shaped field is old -> ignored.
    chat({ id: "research-task", category: "research", intervalHours: undefined, dueAt: iso(-1 * HOUR_MS) }),
    chat({ id: "instant-task", category: "instant", intervalHours: undefined }),
    // Due, but the mock gateway rejects this one's sessionKey with 500.
    chat({ id: FAILING_CHAT_ID, lastRecurringCheckAt: iso(-7 * HOUR_MS) }),

    // --- research-due-check fixtures ---
    // dueAt already passed, still pre-discussion -> due for a status-check nudge.
    chat({ id: "research-due", category: "research", intervalHours: undefined, dueAt: iso(-1 * HOUR_MS) }),
    // dueAt still in the future -> not due yet.
    chat({ id: "research-not-due", category: "research", intervalHours: undefined, dueAt: iso(1 * HOUR_MS) }),
    // dueAt passed, but she already delivered her first summary -> no nudge needed.
    chat({
      id: "research-in-discussion",
      category: "research",
      intervalHours: undefined,
      dueAt: iso(-1 * HOUR_MS),
      researchPhase: "discussion",
    }),
    // dueAt passed, but already nudged once before -> not re-triggered every tick.
    chat({
      id: "research-already-nudged",
      category: "research",
      intervalHours: undefined,
      dueAt: iso(-1 * HOUR_MS),
      dueCheckSentAt: iso(-10 * 60_000),
    }),
    // Due, but the mock gateway rejects this one's sessionKey with 500.
    chat({ id: RESEARCH_FAILING_CHAT_ID, category: "research", intervalHours: undefined, dueAt: iso(-1 * HOUR_MS) }),
  ];

  await fs.mkdir(path.join(tmpCwd, "data"), { recursive: true });
  await fs.writeFile(
    path.join(tmpCwd, "data", "emmy-chats.json"),
    JSON.stringify({ chats, messages: [], archive: [] }, null, 2),
    "utf8",
  );

  store = await import("./emmy-store.js");
  scheduler = await import("./emmy-scheduler.js");
  auditLog = await import("../audit/audit-log.js");
});

after(async () => {
  process.chdir(originalCwd);
  await fs.rm(tmpCwd, { recursive: true, force: true });
  await new Promise<void>((resolve) => mockServer.close(() => resolve()));
});

// One real tick covers every scenario at once (all fixtures already seeded
// above) — cheaper than a fresh store per scenario, and avoids the risk of
// one test's chat becoming newly due by the time a later test's tick runs.
let result: { triggered: string[]; failed: string[] };
test("run the one tick every scenario below asserts against", async () => {
  result = await scheduler.runRecurringTasksTick();
});

test("triggers a recurring chat whose interval has elapsed since the last check", async () => {
  assert.ok(result.triggered.includes("due-recurring"));
  const updated = await store.getChat("due-recurring");
  assert.ok(updated?.lastRecurringCheckAt);
  assert.ok(new Date(updated!.lastRecurringCheckAt!).getTime() > Date.now() - 60_000, "should be bumped to ~now");
});

test("does not trigger a recurring chat still within its interval", async () => {
  assert.ok(!result.triggered.includes("not-due-recurring"));
  assert.ok(!result.failed.includes("not-due-recurring"));
  const untouched = await store.getChat("not-due-recurring");
  assert.ok(untouched?.lastRecurringCheckAt);
  assert.ok(new Date(untouched!.lastRecurringCheckAt!).getTime() < Date.now() - HOUR_MS, "unchanged, still ~2h old");
});

test("on first run (no lastRecurringCheckAt yet) falls back to createdAt", async () => {
  assert.ok(result.triggered.includes("first-run-recurring"));
  const updated = await store.getChat("first-run-recurring");
  assert.ok(updated?.lastRecurringCheckAt, "now has a lastRecurringCheckAt after its first check");
});

test("ignores a done task even if its interval elapsed", async () => {
  assert.ok(!result.triggered.includes("done-recurring"));
  assert.ok(!result.failed.includes("done-recurring"));
});

test("ignores research and instant tasks", async () => {
  assert.ok(!result.triggered.includes("research-task"));
  assert.ok(!result.triggered.includes("instant-task"));
});

test("a failed sendEmmyHookTurn leaves lastRecurringCheckAt untouched so the next tick retries", async () => {
  assert.ok(result.failed.includes(FAILING_CHAT_ID));
  assert.ok(!result.triggered.includes(FAILING_CHAT_ID));
  const untouched = await store.getChat(FAILING_CHAT_ID);
  assert.ok(new Date(untouched!.lastRecurringCheckAt!).getTime() < Date.now() - HOUR_MS, "unchanged, still ~7h old");
});

test("does not block other due chats when one chat's turn fails", async () => {
  // due-recurring and first-run-recurring both still triggered despite
  // gateway-down-recurring failing in the same tick.
  assert.ok(result.triggered.includes("due-recurring"));
  assert.ok(result.triggered.includes("first-run-recurring"));
});

test("summarizes the tick in one audit log entry", async () => {
  const entries = await auditLog.listAuditEntries();
  const entry = entries.find((e) => e.type === "recurring_task_triggered");
  assert.ok(entry, "expected a recurring_task_triggered audit entry");
  assert.equal(entry?.actor, "emmy-scheduler");
  assert.match(entry?.detail ?? "", /triggered=2 failed=1/);
});

test("sent exactly one turn per due chat, addressed to its own isolated session", async () => {
  assert.ok(receivedSessionKeys.includes("agent:main:overlay:due-recurring"));
  assert.ok(receivedSessionKeys.includes("agent:main:overlay:first-run-recurring"));
  assert.ok(receivedSessionKeys.includes(`agent:main:overlay:${FAILING_CHAT_ID}`));
  assert.ok(!receivedSessionKeys.includes("agent:main:overlay:not-due-recurring"));
});

// ---- research due-check tick -------------------------------------------------

let researchResult: { triggered: string[]; failed: string[] };
test("run the research due-check tick every scenario below asserts against", async () => {
  researchResult = await scheduler.runResearchDueChecksTick();
});

test("triggers a research task whose dueAt has passed and is still pre-discussion", async () => {
  assert.ok(researchResult.triggered.includes("research-due"));
  const updated = await store.getChat("research-due");
  assert.ok(updated?.dueCheckSentAt);
  assert.ok(new Date(updated!.dueCheckSentAt!).getTime() > Date.now() - 60_000, "should be stamped to ~now");
});

test("the turn sent to a due research task asks for a status, not another open-ended 'take your time'", async () => {
  const prompt = receivedMessagesByChatId["research-due"];
  assert.ok(prompt, "expected a turn to have been sent for research-due");
  assert.match(prompt, /Status-Check/);
  assert.match(prompt, /noch mehr Zeit/);
  assert.match(prompt, /vollständige, ausführliche Zusammenfassung/);
  assert.doesNotMatch(prompt, /über Nacht sind ausdrücklich erwünscht/);
});

test("does not trigger a research task whose dueAt is still in the future", async () => {
  assert.ok(!researchResult.triggered.includes("research-not-due"));
  const untouched = await store.getChat("research-not-due");
  assert.ok(!untouched?.dueCheckSentAt);
});

test("does not trigger a research task that already delivered its first summary", async () => {
  assert.ok(!researchResult.triggered.includes("research-in-discussion"));
  const untouched = await store.getChat("research-in-discussion");
  assert.ok(!untouched?.dueCheckSentAt);
});

test("does not re-trigger a research task already nudged once", async () => {
  assert.ok(!researchResult.triggered.includes("research-already-nudged"));
  const untouched = await store.getChat("research-already-nudged");
  assert.ok(new Date(untouched!.dueCheckSentAt!).getTime() < Date.now() - 60_000, "unchanged, still the original nudge timestamp");
});

test("a failed sendEmmyHookTurn leaves dueCheckSentAt unset so the next tick retries", async () => {
  assert.ok(researchResult.failed.includes(RESEARCH_FAILING_CHAT_ID));
  assert.ok(!researchResult.triggered.includes(RESEARCH_FAILING_CHAT_ID));
  const untouched = await store.getChat(RESEARCH_FAILING_CHAT_ID);
  assert.ok(!untouched?.dueCheckSentAt);
});

test("summarizes the research due-check tick in one audit log entry", async () => {
  const entries = await auditLog.listAuditEntries();
  const entry = entries.find((e) => e.type === "research_due_check_triggered");
  assert.ok(entry, "expected a research_due_check_triggered audit entry");
  assert.equal(entry?.actor, "emmy-scheduler");
  // triggered=2: "research-due" plus the pre-existing "research-task" fixture
  // (used above only to assert the *recurring* tick ignores it) — it's also a
  // past-dueAt, pre-discussion research chat, so this tick picks it up too.
  assert.match(entry?.detail ?? "", /triggered=2 failed=1/);
});
