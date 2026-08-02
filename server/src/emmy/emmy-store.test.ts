import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// The store file path is computed at module-import time from process.cwd()
// (same pattern as ideachat-store.test.ts) — import dynamically, after
// chdir, not statically at the top of this file.
let tmpCwd: string;
let originalCwd: string;
let store: typeof import("./emmy-store.js");

before(async () => {
  originalCwd = process.cwd();
  tmpCwd = await fs.mkdtemp(path.join(os.tmpdir(), "overlay-emmy-store-test-"));
  process.chdir(tmpCwd);
  store = await import("./emmy-store.js");
});

after(async () => {
  process.chdir(originalCwd);
  await fs.rm(tmpCwd, { recursive: true, force: true });
});

test("listEmmyMessages is empty before anything has been appended", async () => {
  assert.deepEqual(await store.listEmmyMessages(), []);
});

test("appendEmmyMessage persists a message with role/text/timestamp", async () => {
  const message = await store.appendEmmyMessage("me", "Hallo Emmy");
  assert.equal(message.role, "me");
  assert.equal(message.text, "Hallo Emmy");
  assert.ok(message.id);
  assert.ok(message.at);

  const all = await store.listEmmyMessages();
  assert.deepEqual(all, [message]);
});

test("appendEmmyMessage keeps insertion order across roles", async () => {
  const question = await store.appendEmmyMessage("me", "Frage");
  const answer = await store.appendEmmyMessage("emmy", "Antwort");

  const all = await store.listEmmyMessages();
  const questionIndex = all.findIndex((m) => m.id === question.id);
  const answerIndex = all.findIndex((m) => m.id === answer.id);
  assert.ok(questionIndex < answerIndex, "question should be stored before the answer that followed it");
});

test("survives a fresh module instance re-reading from disk", async () => {
  const message = await store.appendEmmyMessage("me", "Persistente Nachricht");
  const fresh = (await import(`./emmy-store.js?fresh=${Date.now()}`)) as typeof import("./emmy-store.js");
  const all = await fresh.listEmmyMessages();
  assert.ok(all.some((m) => m.id === message.id && m.text === "Persistente Nachricht"));
});
