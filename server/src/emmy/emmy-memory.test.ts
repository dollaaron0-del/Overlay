import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { EmmyMessage } from "@overlay/shared";

// config.ts is a frozen singleton, and the store file path is computed at
// module-import time from process.cwd() (same pattern as
// ideachat-store.test.ts) — chdir and set env vars before importing.
let tmpCwd: string;
let originalCwd: string;
let memory: typeof import("./emmy-memory.js");

before(async () => {
  process.env.APPS_ROOT = "/tmp/overlay-emmy-memory-test-apps-root";
  process.env.SESSION_SECRET = "test-session-secret-not-for-prod";
  process.env.ADMIN_USERNAME = "admin";
  process.env.ADMIN_PASSWORD_HASH = "$2b$04$0000000000000000000000000000000000000000000000000000";
  process.env.EMMY_MEMORY_EMBEDDING_MODEL = "test-embed-model";
  process.env.EMMY_MEMORY_VISION_MODEL = "test-vision-model";
  process.env.EMMY_MEMORY_TOP_K = "2";
  process.env.EMMY_MEMORY_MIN_SCORE = "0.5";

  originalCwd = process.cwd();
  tmpCwd = await fs.mkdtemp(path.join(os.tmpdir(), "overlay-emmy-memory-test-"));
  process.chdir(tmpCwd);
  memory = await import("./emmy-memory.js");
});

after(async () => {
  process.chdir(originalCwd);
  await fs.rm(tmpCwd, { recursive: true, force: true });
});

function message(overrides: Partial<EmmyMessage> = {}): EmmyMessage {
  return { id: "m1", chatId: "c1", role: "me", text: "hallo", at: "2026-01-01T00:00:00.000Z", ...overrides };
}

/** Maps fixed keywords to orthogonal-ish vectors so similarity is fully deterministic. */
function fakeEmbed(text: string): number[] {
  if (text.includes("Auto")) return [1, 0, 0];
  if (text.includes("Katze")) return [0, 1, 0];
  if (text.includes("Wetter")) return [0, 0, 1];
  return [0.5, 0.5, 0.5];
}

function stubDeps(calls: { embed: number; caption: number } = { embed: 0, caption: 0 }) {
  return {
    embed: async (_baseUrl: string, _model: string, text: string) => {
      calls.embed++;
      return fakeEmbed(text);
    },
    caption: async () => {
      calls.caption++;
      return "eine Kurzbeschreibung";
    },
  };
}

// ---- pure helpers -------------------------------------------------------------

test("cosineSimilarity is 1 for identical vectors, 0 for orthogonal ones", () => {
  assert.equal(memory.cosineSimilarity([1, 0, 0], [1, 0, 0]), 1);
  assert.equal(memory.cosineSimilarity([1, 0, 0], [0, 1, 0]), 0);
});

test("cosineSimilarity is 0 for mismatched lengths or a zero vector", () => {
  assert.equal(memory.cosineSimilarity([1, 0], [1, 0, 0]), 0);
  assert.equal(memory.cosineSimilarity([0, 0, 0], [1, 0, 0]), 0);
});

test("truncateForPrompt leaves short text untouched and caps long text with an ellipsis", () => {
  assert.equal(memory.truncateForPrompt("kurz", 100), "kurz");
  const long = "x".repeat(50);
  assert.equal(memory.truncateForPrompt(long, 10), `${"x".repeat(10)}…`);
});

test("buildIndexableText folds in attachment names and image captions", () => {
  const text = memory.buildIndexableText(
    "schau dir das an",
    [{ filename: "a.jpg", originalName: "urlaub.jpg", mimeType: "image/jpeg", kind: "image" }],
    { "a.jpg": "ein Strand bei Sonnenuntergang" },
  );
  assert.match(text, /schau dir das an/);
  assert.match(text, /urlaub\.jpg/);
  assert.match(text, /Strand bei Sonnenuntergang/);
});

test("rankMemoryEntries respects top-K, the minimum score, and the exclusion set", () => {
  const entries: [string, import("./emmy-memory.js").MemoryEntry][] = [
    ["auto", { chatId: "c1", chatTitle: "Auto", role: "me", indexedText: "Auto kaufen", embedding: [1, 0, 0], at: "t1" }],
    ["katze", { chatId: "c2", chatTitle: "Katze", role: "me", indexedText: "Katze füttern", embedding: [0, 1, 0], at: "t2" }],
    ["wetter", { chatId: "c3", chatTitle: "Wetter", role: "me", indexedText: "Wetter morgen", embedding: [0, 0, 1], at: "t3" }],
  ];
  // Query close to "auto" and "katze", orthogonal to "wetter" — only the first two clear minScore.
  const hits = memory.rankMemoryEntries(entries, [0.9, 0.9, 0], new Set(), 5, 0.5);
  assert.equal(hits.length, 2);
  assert.deepEqual(
    hits.map((h) => h.chatTitle),
    ["Auto", "Katze"],
  );

  const excluded = memory.rankMemoryEntries(entries, [0.9, 0.9, 0], new Set(["auto"]), 5, 0.5);
  assert.deepEqual(
    excluded.map((h) => h.chatTitle),
    ["Katze"],
  );

  const topK = memory.rankMemoryEntries(entries, [1, 1, 1], new Set(), 1, 0);
  assert.equal(topK.length, 1);
});

// ---- indexing + retrieval, with injected fake Ollama deps ---------------------

test("a message becomes retrievable from a different chat after indexing", async () => {
  const calls = { embed: 0, caption: 0 };
  const deps = stubDeps(calls);

  await memory.indexMessageForMemory(message({ id: "auto-msg", chatId: "chat-a", text: "Ich kaufe ein neues Auto" }), "Auto-Chat", deps);

  const hits = await memory.retrieveMemory("Welches Auto war das nochmal?", new Set(), deps);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].chatId, "chat-a");
  assert.equal(hits[0].chatTitle, "Auto-Chat");
  assert.match(hits[0].snippet, /Auto/);
});

test("excluded message ids (already covered by same-chat recent history) are left out", async () => {
  const deps = stubDeps();
  await memory.indexMessageForMemory(message({ id: "katze-msg", chatId: "chat-b", text: "Meine Katze heißt Minka" }), "Katzen-Chat", deps);

  const hits = await memory.retrieveMemory("Wie heißt meine Katze?", new Set(["katze-msg"]), deps);
  assert.equal(hits.length, 0);
});

test("purging a message removes it from future retrieval", async () => {
  const deps = stubDeps();
  await memory.indexMessageForMemory(message({ id: "wetter-msg", chatId: "chat-c", text: "Das Wetter wird morgen schlecht" }), "Wetter-Chat", deps);
  assert.equal((await memory.retrieveMemory("Wie wird das Wetter?", new Set(), deps)).length, 1);

  await memory.purgeMessagesFromMemory(["wetter-msg"]);
  assert.equal((await memory.retrieveMemory("Wie wird das Wetter?", new Set(), deps)).length, 0);
});

test("indexMessageForMemory captions image attachments via the injected deps, and the caption becomes searchable", async () => {
  const { attachmentsDir } = await import("./emmy-attachments.js");
  const dir = attachmentsDir("chat-d");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "x.jpg"), Buffer.from("not a real jpeg, content is irrelevant here"));

  const calls = { embed: 0, caption: 0 };
  const deps = stubDeps(calls);
  await memory.indexMessageForMemory(
    message({
      id: "img-msg",
      chatId: "chat-d",
      text: "",
      attachments: [{ filename: "x.jpg", originalName: "strand.jpg", mimeType: "image/jpeg", kind: "image" }],
    }),
    "Bilder-Chat",
    deps,
  );
  assert.equal(calls.caption, 1);
  assert.equal(calls.embed, 1);
});
