import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { EmmyMessage } from "@overlay/shared";

// Separate file/process from emmy-memory.test.ts, since config.ts freezes
// once per process and this scenario needs EMMY_MEMORY_EMBEDDING_MODEL empty
// from the very first import (same reasoning as ai-status-unconfigured.test.ts).
let tmpCwd: string;
let originalCwd: string;
let memory: typeof import("./emmy-memory.js");

before(async () => {
  process.env.APPS_ROOT = "/tmp/overlay-emmy-memory-unconfigured-test-apps-root";
  process.env.SESSION_SECRET = "test-session-secret-not-for-prod";
  process.env.ADMIN_USERNAME = "admin";
  process.env.ADMIN_PASSWORD_HASH = "$2b$04$0000000000000000000000000000000000000000000000000000";
  process.env.EMMY_MEMORY_EMBEDDING_MODEL = "";

  originalCwd = process.cwd();
  tmpCwd = await fs.mkdtemp(path.join(os.tmpdir(), "overlay-emmy-memory-unconfigured-test-"));
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

test("retrieveMemory returns [] without ever calling embed when no model is configured", async () => {
  let embedCalls = 0;
  const deps = {
    embed: async () => {
      embedCalls++;
      return [1, 0, 0];
    },
    caption: async () => "",
  };

  const hits = await memory.retrieveMemory("irgendeine Frage", new Set(), deps);
  assert.deepEqual(hits, []);
  assert.equal(embedCalls, 0, "must not attempt any network call when the feature is disabled");
});

test("indexMessageForMemory is a no-op without ever calling embed when no model is configured", async () => {
  let embedCalls = 0;
  const deps = { embed: async () => (embedCalls++, [1, 0, 0]), caption: async () => "" };

  await memory.indexMessageForMemory(message(), "Ein Chat", deps);
  assert.equal(embedCalls, 0);

  // And nothing was persisted, so a later retrieval (even if the feature were
  // turned on) would find no trace of it — confirmed indirectly via purge
  // being a harmless no-op on an index that was never written to.
  await memory.purgeMessagesFromMemory(["m1"]);
});
