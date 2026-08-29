import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildConversationDigest,
  buildProseDigestPrompt,
  buildProseDigest,
} from "./emmy-conversation-reset.js";

const CONVO = [
  { role: "me" as const, text: "Wie machen wir den Failover fürs zweite Claude-Abo?", at: "2026-08-29T10:00:00Z" },
  { role: "emmy" as const, text: "Über ein lokales Plugin claude-cli2 mit eigenem CLAUDE_CONFIG_DIR.", at: "2026-08-29T10:01:00Z" },
  { role: "me" as const, text: "ok mach das", at: "2026-08-29T10:05:00Z" },
];

test("buildConversationDigest keeps the dated header and both speakers", () => {
  const digest = buildConversationDigest(CONVO);
  assert.match(digest, /Frühere Unterhaltung im Allgemein-Chat \(29\.08\.2026, 3 Nachrichten\)/);
  assert.match(digest, /Was Aaron gesagt\/gefragt hat:/);
  assert.match(digest, /claude-cli2/);
});

test("buildConversationDigest returns empty string for a blank conversation", () => {
  assert.equal(buildConversationDigest([{ role: "me", text: "   ", at: "2026-08-29T10:00:00Z" }]), "");
});

test("buildProseDigestPrompt renders a labelled transcript and asks for prose", () => {
  const prompt = buildProseDigestPrompt(CONVO);
  assert.match(prompt, /Aaron: Wie machen wir den Failover/);
  assert.match(prompt, /Emmy: Über ein lokales Plugin/);
  assert.match(prompt, /keine Aufzählungspunkte/);
});

test("buildProseDigest returns trimmed prose from the generator", async () => {
  const out = await buildProseDigest(
    CONVO,
    "test-model",
    async () => "  Aaron und Emmy haben den Abo-Failover geklärt: claude-cli2-Plugin, Aaron gab grünes Licht.  ",
  );
  assert.equal(out, "Aaron und Emmy haben den Abo-Failover geklärt: claude-cli2-Plugin, Aaron gab grünes Licht.");
});

test("buildProseDigest returns null when no model is configured", async () => {
  assert.equal(await buildProseDigest(CONVO, "", async () => "should not be called"), null);
});

test("buildProseDigest returns null for a blank conversation", async () => {
  assert.equal(
    await buildProseDigest([{ role: "me", text: "  ", at: "2026-08-29T10:00:00Z" }], "test-model", async () => "x".repeat(100)),
    null,
  );
});

test("buildProseDigest falls back to null on generator error or implausible output", async () => {
  assert.equal(
    await buildProseDigest(CONVO, "test-model", async () => {
      throw new Error("ollama down");
    }),
    null,
  );
  assert.equal(await buildProseDigest(CONVO, "test-model", async () => "zu kurz"), null);
  assert.equal(await buildProseDigest(CONVO, "test-model", async () => "x".repeat(5000)), null);
});
