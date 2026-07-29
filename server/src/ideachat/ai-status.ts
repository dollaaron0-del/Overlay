import { config } from "../config.js";
import { listOllamaModels, modelIsInstalled, OllamaUnavailableError } from "../security/ollama-client.js";
import { runCommand } from "../security/run-tool.js";

export type AiTierId = "ollama-ram" | "ollama-gpu" | "claude";

export interface AiTierStatus {
  id: AiTierId;
  label: string;
  /** What this tier is responsible for in the cascade, shown to the user. */
  role: string;
  configured: boolean;
  reachable?: boolean;
  model?: string;
  modelInstalled?: boolean;
  error?: string;
}

const STATUS_TIMEOUT_MS = 5000; // a quick liveness ping, same budget as the security dashboard's Ollama check

async function ollamaTierStatus(id: AiTierId, label: string, role: string, baseUrl: string, model: string): Promise<AiTierStatus> {
  if (!model) return { id, label, role, configured: false };
  try {
    const models = await listOllamaModels(baseUrl, STATUS_TIMEOUT_MS);
    return { id, label, role, configured: true, reachable: true, model, modelInstalled: modelIsInstalled(model, models) };
  } catch (err) {
    return {
      id,
      label,
      role,
      configured: true,
      reachable: false,
      model,
      error: err instanceof OllamaUnavailableError ? `${baseUrl} antwortet nicht` : (err as Error).message,
    };
  }
}

async function claudeTierStatus(): Promise<AiTierStatus> {
  const role = "Letzte Stufe: echter Projekt-/Codezugriff (lesend) für alles, was die lokalen Modelle eskalieren";
  try {
    const result = await runCommand(config.CLAUDE_COMMAND, ["--version"], { timeoutMs: STATUS_TIMEOUT_MS });
    return { id: "claude", label: "Claude", role, configured: true, reachable: result.exitCode === 0 };
  } catch {
    return {
      id: "claude",
      label: "Claude",
      role,
      configured: true,
      reachable: false,
      error: `Befehl "${config.CLAUDE_COMMAND}" nicht gefunden`,
    };
  }
}

/** The idea-chat cascade's tiers, in the order a message is actually tried against them. */
export async function getAiCascadeStatus(): Promise<AiTierStatus[]> {
  const [ram, gpu, claude] = await Promise.all([
    ollamaTierStatus(
      "ollama-ram",
      "RAM-Ollama",
      "1. Stufe: schnelle Einschätzung reiner Diskussion, kein Code-Zugriff",
      config.IDEA_CHAT_OLLAMA_RAM_URL,
      config.IDEA_CHAT_OLLAMA_RAM_MODEL,
    ),
    ollamaTierStatus(
      "ollama-gpu",
      "GPU-Ollama",
      "2. Stufe: anspruchsvollere Einschätzung, ebenfalls kein Code-Zugriff",
      config.IDEA_CHAT_OLLAMA_GPU_URL,
      config.IDEA_CHAT_OLLAMA_GPU_MODEL,
    ),
    claudeTierStatus(),
  ]);
  return [ram, gpu, claude];
}
