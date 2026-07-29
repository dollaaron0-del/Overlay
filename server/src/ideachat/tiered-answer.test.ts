import { test, before } from "node:test";
import assert from "node:assert/strict";
import type { IdeaChatMessage } from "./ideachat.types.js";

// config.ts is a frozen singleton — import dynamically after setting env
// vars, same pattern as ideachat.test.ts.
let answerIdeaChatMessage: typeof import("./tiered-answer.js").answerIdeaChatMessage;
let messagesSinceLastClaudeTurn: typeof import("./tiered-answer.js").messagesSinceLastClaudeTurn;
let buildClaudeRecap: typeof import("./tiered-answer.js").buildClaudeRecap;

before(async () => {
  process.env.APPS_ROOT = "/tmp/overlay-tiered-answer-test-apps-root";
  process.env.SESSION_SECRET = "test-session-secret-not-for-prod";
  process.env.ADMIN_USERNAME = "admin";
  process.env.ADMIN_PASSWORD_HASH = "$2b$04$0000000000000000000000000000000000000000000000000000";
  // Both tiers configured so the cascade actually has something to call —
  // the injected stubs below never touch these URLs for real.
  process.env.IDEA_CHAT_OLLAMA_RAM_MODEL = "ram-model";
  process.env.IDEA_CHAT_OLLAMA_GPU_MODEL = "gpu-model";

  ({ answerIdeaChatMessage, messagesSinceLastClaudeTurn, buildClaudeRecap } = await import("./tiered-answer.js"));
});

function stubOllama(results: Array<{ escalate: boolean; answer: string } | null>) {
  let i = 0;
  const calls: Array<{ baseUrl: string; model: string }> = [];
  const fn = async (baseUrl: string, model: string) => {
    calls.push({ baseUrl, model });
    return results[i++] ?? null;
  };
  return Object.assign(fn, { calls });
}

function stubClaude(reply: string, sessionId = "new-claude-session") {
  const calls: Array<{ message: string; cwd: string; sessionId: string | null }> = [];
  const fn = async (message: string, cwd: string, sid: string | null) => {
    calls.push({ message, cwd, sessionId: sid });
    return { sessionId, reply };
  };
  return Object.assign(fn, { calls });
}

test("answers from the RAM tier when it doesn't escalate, without touching GPU or Claude", async () => {
  const ram = stubOllama([{ escalate: false, answer: "RAM-Antwort" }]);
  const gpu = stubOllama([]);
  const claude = stubClaude("sollte nicht aufgerufen werden");

  const result = await answerIdeaChatMessage([], "Ist Dark Mode sinnvoll?", "/proj", null, {
    tryOllamaTier: ram as unknown as typeof import("./ideachat-ollama.js").tryOllamaTier,
    sendIdeaChatMessage: claude,
  });

  assert.deepEqual(result, { source: "ollama-ram", reply: "RAM-Antwort", claudeSessionId: null });
  assert.equal(ram.calls.length, 1);
  assert.equal(claude.calls.length, 0);
});

test("falls through to Claude when both Ollama tiers escalate", async () => {
  let ramCalls = 0;
  const ram = Object.assign(async () => (ramCalls++, { escalate: true, answer: "" }), {});
  const claude = stubClaude("Claude-Antwort", "sess-xyz");

  const result = await answerIdeaChatMessage([], "Schreib mir den Code für X", "/proj", null, {
    tryOllamaTier: ram as unknown as typeof import("./ideachat-ollama.js").tryOllamaTier,
    sendIdeaChatMessage: claude,
  });

  assert.equal(result.source, "claude");
  assert.equal(result.reply, "Claude-Antwort");
  assert.equal(result.claudeSessionId, "sess-xyz");
  assert.equal(claude.calls.length, 1);
  assert.equal(claude.calls[0].sessionId, null);
});

test("passes an existing claudeSessionId through on an Ollama-answered turn", async () => {
  const ram = stubOllama([{ escalate: false, answer: "RAM-Antwort" }]);
  const claude = stubClaude("nicht aufgerufen");

  const result = await answerIdeaChatMessage([], "Frage", "/proj", "existing-session", {
    tryOllamaTier: ram as unknown as typeof import("./ideachat-ollama.js").tryOllamaTier,
    sendIdeaChatMessage: claude,
  });

  assert.equal(result.claudeSessionId, "existing-session");
  assert.equal(claude.calls.length, 0);
});

test("escalating to Claude includes a recap of Ollama-only turns Claude hasn't seen", async () => {
  const messages: IdeaChatMessage[] = [
    { role: "user", text: "Erste Frage", at: "t1" },
    { role: "assistant", text: "Ollama-Antwort", at: "t2", source: "ollama-ram" },
  ];
  let ramCalls = 0;
  const ram = Object.assign(async () => (ramCalls++, { escalate: true, answer: "" }), {});
  const claude = stubClaude("Claude-Antwort", "sess-1");

  await answerIdeaChatMessage(messages, "Jetzt bau den Code", "/proj", null, {
    tryOllamaTier: ram as unknown as typeof import("./ideachat-ollama.js").tryOllamaTier,
    sendIdeaChatMessage: claude,
  });

  assert.match(claude.calls[0].message, /Erste Frage/);
  assert.match(claude.calls[0].message, /Ollama-Antwort/);
  assert.match(claude.calls[0].message, /Jetzt bau den Code$/);
});

test("no recap is added when Claude already handled the most recent turns", async () => {
  const messages: IdeaChatMessage[] = [
    { role: "user", text: "Frage 1", at: "t1" },
    { role: "assistant", text: "Claude-Antwort 1", at: "t2", source: "claude" },
  ];
  const claude = stubClaude("Claude-Antwort 2", "sess-1");

  await answerIdeaChatMessage(messages, "Frage 2", "/proj", "sess-1", {
    tryOllamaTier: (async () => ({ escalate: true, answer: "" })) as unknown as typeof import("./ideachat-ollama.js").tryOllamaTier,
    sendIdeaChatMessage: claude,
  });

  assert.equal(claude.calls[0].message, "Frage 2");
});

test("messagesSinceLastClaudeTurn returns everything when Claude has never answered", () => {
  const messages: IdeaChatMessage[] = [
    { role: "user", text: "A", at: "t1" },
    { role: "assistant", text: "B", at: "t2", source: "ollama-gpu" },
  ];
  assert.deepEqual(messagesSinceLastClaudeTurn(messages), messages);
});

test("buildClaudeRecap returns an empty string when there is nothing to recap", () => {
  assert.equal(buildClaudeRecap([]), "");
});
