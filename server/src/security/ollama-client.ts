export class OllamaUnavailableError extends Error {}

/**
 * Minimal client for Ollama's /api/generate endpoint. No extra npm
 * dependency needed — Node's built-in fetch is enough for this one call.
 */
export async function generateOllamaCompletion(
  baseUrl: string,
  model: string,
  prompt: string,
  timeoutMs: number,
  format?: "json",
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(new URL("/api/generate", baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt, stream: false, ...(format ? { format } : {}) }),
      signal: controller.signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      throw new Error(`Ollama request timed out after ${timeoutMs}ms`);
    }
    // Connection refused, DNS failure, etc. — Ollama isn't reachable at all.
    throw new OllamaUnavailableError(`Could not reach Ollama at ${baseUrl}: ${(err as Error).message}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Ollama returned ${response.status}: ${body.slice(0, 500)}`);
  }

  const json = (await response.json()) as { response?: string };
  if (typeof json.response !== "string") {
    throw new Error("Ollama response missing expected 'response' field");
  }
  return json.response;
}

/**
 * Lists installed model names via Ollama's /api/tags — used for a quick
 * dashboard status check (is Ollama up, is the configured model actually
 * pulled), not for the nightly triage itself.
 */
export async function listOllamaModels(baseUrl: string, timeoutMs: number): Promise<string[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(new URL("/api/tags", baseUrl), { signal: controller.signal });
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      throw new Error(`Ollama request timed out after ${timeoutMs}ms`);
    }
    throw new OllamaUnavailableError(`Could not reach Ollama at ${baseUrl}: ${(err as Error).message}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`Ollama returned ${response.status}`);
  }

  const json = (await response.json()) as { models?: Array<{ name: string }> };
  return (json.models ?? []).map((m) => m.name);
}

/** True if `model` (e.g. "llama3.1") matches one of Ollama's installed tags (e.g. "llama3.1:latest"). */
export function modelIsInstalled(model: string, installedNames: string[]): boolean {
  return installedNames.some((name) => name === model || name.startsWith(`${model}:`));
}
