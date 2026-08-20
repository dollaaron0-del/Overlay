import fs from "node:fs/promises";
import path from "node:path";
import { resolveProjectDir } from "../projects/projects.registry.js";
import type { Project } from "../projects/projects.types.js";
import type { IdeaChat } from "./ideachat.types.js";
import { sendIdeaChatMessage } from "./ideachat.js";
import { buildFrontmatter } from "../obsidian/obsidian-note.js";

// Re-exported for backward compatibility — plan-writer.test.ts and any
// other existing importer still get it from here; the implementation now
// lives in util/slug.ts.
export { slugify } from "../util/slug.js";
import { slugify } from "../util/slug.js";

// Sent via --resume on the chat's existing claude session, so the model
// already has the full conversation in context — it only needs to be told
// to condense it, not have the transcript pasted back in.
const SYNTHESIS_PROMPT =
  "Fasse das gesamte bisherige Gespräch zu einem klaren, umsetzungsfertigen Plan zusammen. Gliedere in: " +
  "1) Ausgangsidee (kurz), 2) Entscheidung/Ansatz, 3) konkrete Umsetzungsschritte, 4) offene Fragen (falls vorhanden). " +
  "Antworte nur mit dem fertigen Plan in Markdown, keine Rückfragen, keine Einleitung, kein Text davor oder danach.";

/**
 * Asks the model to condense the whole chat (not just its last reply) into
 * an implementation-ready plan, then writes that into <project>/plans/ as a
 * new markdown file. The filename is built purely from a sanitized
 * timestamp and a slugified title (see slugify) — the model itself never
 * has Write access (see ideachat.ts), only this backend code creates the
 * file. `synthesize` is injectable for tests; defaults to the real CLI call.
 */
export async function writeIdeaPlan(
  project: Project,
  chat: IdeaChat,
  synthesize: typeof sendIdeaChatMessage = sendIdeaChatMessage,
): Promise<{ filename: string; relativePath: string }> {
  if (!chat.messages.some((m) => m.role === "assistant")) {
    throw new Error("Dieser Chat hat noch keine Antwort, aus der sich ein Plan zusammenfassen ließe.");
  }

  const projectDir = resolveProjectDir(project);

  // If a local Ollama tier answered every turn, Claude has never seen this
  // chat and there's no session to --resume — give it the whole transcript
  // inline instead so the summary is still grounded in the real
  // conversation, not just the synthesis instruction on its own.
  const prompt = chat.claudeSessionId
    ? SYNTHESIS_PROMPT
    : `${chat.messages.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.text}`).join("\n\n")}\n\n${SYNTHESIS_PROMPT}`;

  const { reply } = await synthesize(prompt, projectDir, chat.claudeSessionId);

  const plansDir = path.join(projectDir, "plans");
  await fs.mkdir(plansDir, { recursive: true });

  const now = new Date();
  const isoStamp = now.toISOString().replace(/[:.]/g, "-");
  const filename = `${isoStamp}-${slugify(chat.title)}.md`;

  const frontmatter = buildFrontmatter({
    tags: ["idee-plan"],
    project: project.id,
    "chat-id": chat.id,
    created: now.toISOString(),
  });
  const content = `${frontmatter}\n# Ideenplan: ${chat.title}\n\nErstellt: ${now.toLocaleString("de-DE")}\n\n${reply}\n`;

  await fs.writeFile(path.join(plansDir, filename), content, "utf8");
  return { filename, relativePath: `plans/${filename}` };
}
