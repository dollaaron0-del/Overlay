import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// The store file path is computed at module-import time from process.cwd()
// (same pattern as quickcapture-store.ts) — import dynamically, after
// chdir, not statically at the top of this file.
let tmpCwd: string;
let originalCwd: string;
let store: typeof import("./ideachat-store.js");

before(async () => {
  originalCwd = process.cwd();
  tmpCwd = await fs.mkdtemp(path.join(os.tmpdir(), "overlay-ideachat-store-test-"));
  process.chdir(tmpCwd);
  store = await import("./ideachat-store.js");
});

after(async () => {
  process.chdir(originalCwd);
  await fs.rm(tmpCwd, { recursive: true, force: true });
});

test("listIdeaChats is empty before anything has been created", async () => {
  assert.deepEqual(await store.listIdeaChats(), []);
});

test("createIdeaChat persists a chat with the first user message and a derived title", async () => {
  const chat = await store.createIdeaChat("demo-app", "Was hältst du davon, Dark Mode einzubauen?");
  assert.equal(chat.projectId, "demo-app");
  assert.equal(chat.claudeSessionId, null);
  assert.equal(chat.messages.length, 1);
  assert.equal(chat.messages[0].role, "user");
  assert.equal(chat.title, "Was hältst du davon, Dark Mode einzubauen?");

  const fetched = await store.getIdeaChat(chat.id);
  assert.deepEqual(fetched, chat);
});

test("createIdeaChat truncates a long first message for the title", async () => {
  const longMessage = "x".repeat(120);
  const chat = await store.createIdeaChat("demo-app", longMessage);
  assert.equal(chat.title.length, 61); // 60 chars + ellipsis
  assert.ok(chat.title.endsWith("…"));
});

test("appendIdeaChatMessages adds messages and records the claude session id", async () => {
  const chat = await store.createIdeaChat("demo-app", "Erste Idee");
  const updated = await store.appendIdeaChatMessages(
    chat.id,
    [{ role: "assistant", text: "Das klingt sinnvoll.", at: new Date().toISOString() }],
    "claude-session-abc",
  );
  assert.ok(updated);
  assert.equal(updated!.claudeSessionId, "claude-session-abc");
  assert.equal(updated!.messages.length, 2);
  assert.equal(updated!.messages[1].text, "Das klingt sinnvoll.");
  assert.ok(updated!.updatedAt >= updated!.createdAt);
});

test("appendIdeaChatMessages returns undefined for an unknown chat id", async () => {
  const result = await store.appendIdeaChatMessages("does-not-exist", [], "sid");
  assert.equal(result, undefined);
});

test("listIdeaChats returns most-recently-updated first", async () => {
  const first = await store.createIdeaChat("demo-app", "Ältere Idee");
  await new Promise((r) => setTimeout(r, 5));
  const second = await store.createIdeaChat("demo-app", "Neuere Idee");

  const list = await store.listIdeaChats();
  const firstIndex = list.findIndex((c) => c.id === first.id);
  const secondIndex = list.findIndex((c) => c.id === second.id);
  assert.ok(secondIndex < firstIndex, "newer chat should sort before older chat");
});

test("survives a fresh module instance re-reading from disk", async () => {
  const chat = await store.createIdeaChat("demo-app", "Persistente Idee");
  const fresh = (await import(`./ideachat-store.js?fresh=${Date.now()}`)) as typeof import("./ideachat-store.js");
  const fetched = await fresh.getIdeaChat(chat.id);
  assert.equal(fetched?.title, "Persistente Idee");
});
