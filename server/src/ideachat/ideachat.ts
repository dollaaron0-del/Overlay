import crypto from "node:crypto";
import { runCommand } from "../security/run-tool.js";
import { config } from "../config.js";

// Read-only tool access: the model can look at the project's code to give
// grounded feedback and draft a plan, but can never edit/write/run anything
// itself. Any file that ends up on disk (see plan-writer.ts) is written by
// our own backend, not by the model.
const IDEA_CHAT_TOOLS = "Read,Glob,Grep";

interface RawClaudePrintResult {
  is_error?: boolean;
  result?: string;
  session_id?: string;
  subtype?: string;
}

export interface IdeaChatReply {
  sessionId: string;
  reply: string;
}

/**
 * Builds the argv for a single headless `claude -p` turn. The first turn of
 * a chat has no prior sessionId and gets one assigned via --session-id (so
 * we control it and can store it); every later turn resumes that same id via
 * --resume, which is how the CLI recovers the prior conversation's context.
 */
export function buildIdeaChatArgs(message: string, sessionId: string | null): string[] {
  const args = ["-p", message, "--output-format", "json", "--tools", IDEA_CHAT_TOOLS, "--permission-mode", "dontAsk"];
  if (sessionId) {
    args.push("--resume", sessionId);
  } else {
    args.push("--session-id", crypto.randomUUID());
  }
  return args;
}

/** Parses `claude --output-format json`'s single-result object. */
export function parseClaudeResult(stdout: string): IdeaChatReply {
  let parsed: RawClaudePrintResult;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`claude CLI produced non-JSON output: ${stdout.slice(0, 500)}`);
  }
  if (parsed.is_error || typeof parsed.result !== "string") {
    throw new Error(`claude CLI returned an error result (subtype: ${parsed.subtype ?? "unknown"})`);
  }
  if (typeof parsed.session_id !== "string" || parsed.session_id.length === 0) {
    throw new Error("claude CLI result is missing a session_id");
  }
  return { sessionId: parsed.session_id, reply: parsed.result };
}

/**
 * Sends one message to the real `claude` CLI, scoped to `cwd` (the target
 * project's directory), and returns the reply plus the session id to
 * --resume on the next turn. `sessionId` is null only for a chat's very
 * first message.
 */
export async function sendIdeaChatMessage(message: string, cwd: string, sessionId: string | null): Promise<IdeaChatReply> {
  const args = buildIdeaChatArgs(message, sessionId);
  const result = await runCommand(config.CLAUDE_COMMAND, args, { cwd, timeoutMs: config.IDEA_CHAT_TIMEOUT_MS });
  if (result.exitCode !== 0) {
    throw new Error(`claude CLI exited with code ${result.exitCode}: ${result.stderr.slice(0, 500)}`);
  }
  return parseClaudeResult(result.stdout);
}
