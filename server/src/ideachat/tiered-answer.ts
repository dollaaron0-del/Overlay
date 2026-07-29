import { config } from "../config.js";
import { tryOllamaTier } from "./ideachat-ollama.js";
import { sendIdeaChatMessage } from "./ideachat.js";
import type { AnswerSource, IdeaChatMessage } from "./ideachat.types.js";

export interface AnsweredMessage {
  source: AnswerSource;
  reply: string;
  /** Unchanged unless this turn actually went to Claude. */
  claudeSessionId: string | null;
}

/** Every message after the last claude-sourced one — the part Claude hasn't seen via --resume. */
export function messagesSinceLastClaudeTurn(messages: IdeaChatMessage[]): IdeaChatMessage[] {
  const lastClaudeIndex = messages.reduce((acc, m, i) => (m.source === "claude" ? i : acc), -1);
  return messages.slice(lastClaudeIndex + 1);
}

/** Recaps any Ollama-only turns Claude wouldn't otherwise know about, so it never starts blind. */
export function buildClaudeRecap(messages: IdeaChatMessage[]): string {
  const since = messagesSinceLastClaudeTurn(messages);
  if (since.length === 0) return "";
  const transcript = since.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.text}`).join("\n\n");
  return (
    "[Bisheriger Gesprächsverlauf, von einem anderen (lokalen) Modell beantwortet — du warst hieran noch " +
    `nicht beteiligt]\n${transcript}\n[Ende des bisherigen Verlaufs]`
  );
}

export interface TieredAnswerDeps {
  tryOllamaTier: typeof tryOllamaTier;
  sendIdeaChatMessage: typeof sendIdeaChatMessage;
}

const defaultDeps: TieredAnswerDeps = { tryOllamaTier, sendIdeaChatMessage };

/**
 * Tries the RAM-Ollama tier, then the GPU-Ollama tier, then falls through to
 * the real claude CLI — each Ollama tier decides for itself whether it can
 * answer or the request needs actual code access (see ideachat-ollama.ts).
 * A tier that's unconfigured (empty model) or unreachable is skipped, never
 * blocking the chat. `deps` is injectable for tests.
 */
export async function answerIdeaChatMessage(
  messages: IdeaChatMessage[],
  newUserMessage: string,
  projectDir: string,
  claudeSessionId: string | null,
  deps: TieredAnswerDeps = defaultDeps,
): Promise<AnsweredMessage> {
  if (config.IDEA_CHAT_OLLAMA_RAM_MODEL) {
    const result = await deps.tryOllamaTier(
      config.IDEA_CHAT_OLLAMA_RAM_URL,
      config.IDEA_CHAT_OLLAMA_RAM_MODEL,
      messages,
      newUserMessage,
      config.IDEA_CHAT_OLLAMA_TIMEOUT_MS,
    );
    if (result && !result.escalate) {
      return { source: "ollama-ram", reply: result.answer, claudeSessionId };
    }
  }

  if (config.IDEA_CHAT_OLLAMA_GPU_MODEL) {
    const result = await deps.tryOllamaTier(
      config.IDEA_CHAT_OLLAMA_GPU_URL,
      config.IDEA_CHAT_OLLAMA_GPU_MODEL,
      messages,
      newUserMessage,
      config.IDEA_CHAT_OLLAMA_TIMEOUT_MS,
    );
    if (result && !result.escalate) {
      return { source: "ollama-gpu", reply: result.answer, claudeSessionId };
    }
  }

  const recap = buildClaudeRecap(messages);
  const messageForClaude = recap ? `${recap}\n\n${newUserMessage}` : newUserMessage;
  const claudeReply = await deps.sendIdeaChatMessage(messageForClaude, projectDir, claudeSessionId);
  return { source: "claude", reply: claudeReply.reply, claudeSessionId: claudeReply.sessionId };
}
