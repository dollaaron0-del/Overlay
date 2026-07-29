import { generateOllamaCompletion } from "../security/ollama-client.js";
import type { IdeaChatMessage } from "./ideachat.types.js";

export interface OllamaTierResult {
  escalate: boolean;
  /** Empty when escalate is true. */
  answer: string;
}

// Unlike the claude CLI tier, a local Ollama model gets no tool access at
// all here (no Read/Glob/Grep) — it only ever sees this chat's own text, so
// it's told upfront to escalate anything that actually needs the codebase.
const SYSTEM_INSTRUCTIONS =
  "Du bist ein Ideen-Sparringspartner für Softwareprojekte. Du hast KEINEN Zugriff auf den Quellcode des " +
  "Projekts, nur auf dieses Gespräch.\n\n" +
  "Beurteile die letzte Nutzer-Nachricht: Reicht reine Diskussion (Einschätzung, Für/Wider, grobe Idee) aus " +
  "deinem Allgemeinwissen? Oder braucht eine gute Antwort tatsächlichen Blick in den Code, präzises " +
  "Programmieren oder Projekt-Detailwissen? Im zweiten Fall eskaliere.\n\n" +
  'Antworte AUSSCHLIESSLICH mit einem JSON-Objekt: {"escalate": true oder false, ' +
  '"answer": "deine Antwort falls escalate=false, sonst ein leerer String"}';

export function buildOllamaTierPrompt(messages: IdeaChatMessage[], newUserMessage: string): string {
  const transcript = messages.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.text}`).join("\n\n");
  const historyBlock = transcript ? `${transcript}\n\n` : "";
  return `${SYSTEM_INSTRUCTIONS}\n\n${historyBlock}User: ${newUserMessage}`;
}

/** Parses the model's `{escalate, answer}` JSON. Anything that doesn't clearly say "I can answer this" escalates. */
export function parseOllamaTierResponse(raw: string): OllamaTierResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { escalate: true, answer: "" };
  }
  if (typeof parsed !== "object" || parsed === null) return { escalate: true, answer: "" };
  const obj = parsed as Record<string, unknown>;
  if (obj.escalate === true) return { escalate: true, answer: "" };
  if (typeof obj.answer === "string" && obj.answer.trim()) {
    return { escalate: false, answer: obj.answer };
  }
  return { escalate: true, answer: "" };
}

/**
 * Tries one local Ollama tier. Returns null if the tier is unreachable or
 * errors — the caller should treat that the same as "escalate" and move on
 * to the next tier, since a broken local model must never block the chat.
 */
export async function tryOllamaTier(
  baseUrl: string,
  model: string,
  messages: IdeaChatMessage[],
  newUserMessage: string,
  timeoutMs: number,
): Promise<OllamaTierResult | null> {
  try {
    const prompt = buildOllamaTierPrompt(messages, newUserMessage);
    const raw = await generateOllamaCompletion(baseUrl, model, prompt, timeoutMs, "json");
    return parseOllamaTierResponse(raw);
  } catch {
    return null;
  }
}
