import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { buildOllamaTierPrompt, parseOllamaTierResponse, tryOllamaTier } from "./ideachat-ollama.js";
import type { IdeaChatMessage } from "./ideachat.types.js";

async function withMockServer(handler: http.RequestListener, run: (baseUrl: string) => Promise<void>): Promise<void> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("expected a bound TCP address");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await run(baseUrl);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("buildOllamaTierPrompt includes prior turns and the new message", () => {
  const messages: IdeaChatMessage[] = [
    { role: "user", text: "Erste Frage", at: "t1" },
    { role: "assistant", text: "Erste Antwort", at: "t2", source: "ollama-ram" },
  ];
  const prompt = buildOllamaTierPrompt(messages, "Zweite Frage");
  assert.match(prompt, /Erste Frage/);
  assert.match(prompt, /Erste Antwort/);
  assert.match(prompt, /User: Zweite Frage$/);
  assert.match(prompt, /KEINEN Zugriff auf den Quellcode/);
});

test("buildOllamaTierPrompt works with an empty history (first message)", () => {
  const prompt = buildOllamaTierPrompt([], "Erste Frage überhaupt");
  assert.match(prompt, /User: Erste Frage überhaupt$/);
});

test("parseOllamaTierResponse accepts a well-formed non-escalating reply", () => {
  const result = parseOllamaTierResponse('{"escalate": false, "answer": "Klingt sinnvoll."}');
  assert.deepEqual(result, { escalate: false, answer: "Klingt sinnvoll." });
});

test("parseOllamaTierResponse treats explicit escalate:true as escalation", () => {
  const result = parseOllamaTierResponse('{"escalate": true, "answer": ""}');
  assert.equal(result.escalate, true);
});

test("parseOllamaTierResponse escalates on malformed JSON rather than guessing", () => {
  assert.deepEqual(parseOllamaTierResponse("not json at all"), { escalate: true, answer: "" });
});

test("parseOllamaTierResponse escalates when answer is missing or blank", () => {
  assert.equal(parseOllamaTierResponse('{"escalate": false}').escalate, true);
  assert.equal(parseOllamaTierResponse('{"escalate": false, "answer": "   "}').escalate, true);
});

test("tryOllamaTier returns the parsed result on a successful call", async () => {
  await withMockServer(
    (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ response: '{"escalate": false, "answer": "Gute Idee, hier ein paar Gedanken."}' }));
    },
    async (baseUrl) => {
      const result = await tryOllamaTier(baseUrl, "llama3.1", [], "Sollen wir X bauen?", 5000);
      assert.deepEqual(result, { escalate: false, answer: "Gute Idee, hier ein paar Gedanken." });
    },
  );
});

test("tryOllamaTier returns null (not escalate) when the tier is unreachable", async () => {
  const result = await tryOllamaTier("http://127.0.0.1:1", "llama3.1", [], "Frage", 2000);
  assert.equal(result, null);
});

test("tryOllamaTier returns null when the server errors", async () => {
  await withMockServer(
    (_req, res) => {
      res.writeHead(500);
      res.end("boom");
    },
    async (baseUrl) => {
      const result = await tryOllamaTier(baseUrl, "llama3.1", [], "Frage", 5000);
      assert.equal(result, null);
    },
  );
});
