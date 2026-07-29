import fs from "node:fs/promises";
import path from "node:path";
import { resolveProjectDir } from "../projects/projects.registry.js";
import type { Project } from "../projects/projects.types.js";
import type { IdeaChat } from "./ideachat.types.js";

/** Lowercase, [a-z0-9-] only, no leading/trailing/duplicate dashes — never a raw path segment from client input. */
export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug || "idee";
}

/**
 * Writes the chat's latest assistant reply into <project>/plans/ as a new
 * markdown file. The filename is built purely from a sanitized timestamp
 * and a slugified title (see slugify) — the model itself never has Write
 * access (see ideachat.ts), only this backend code creates the file.
 */
export async function writeIdeaPlan(project: Project, chat: IdeaChat): Promise<{ filename: string; relativePath: string }> {
  const firstUserMessage = chat.messages.find((m) => m.role === "user");
  const lastAssistantMessage = [...chat.messages].reverse().find((m) => m.role === "assistant");
  if (!lastAssistantMessage) {
    throw new Error("Dieser Chat hat noch keine Antwort, die als Plan gespeichert werden könnte.");
  }

  const projectDir = resolveProjectDir(project);
  const plansDir = path.join(projectDir, "plans");
  await fs.mkdir(plansDir, { recursive: true });

  const now = new Date();
  const isoStamp = now.toISOString().replace(/[:.]/g, "-");
  const filename = `${isoStamp}-${slugify(chat.title)}.md`;

  const parts = [
    `# Ideenplan: ${chat.title}`,
    `Erstellt: ${now.toLocaleString("de-DE")}`,
    ...(firstUserMessage ? [`## Ursprüngliche Idee`, firstUserMessage.text] : []),
    `## Ausgearbeiteter Plan`,
    lastAssistantMessage.text,
  ];
  const content = `${parts.join("\n\n")}\n`;

  await fs.writeFile(path.join(plansDir, filename), content, "utf8");
  return { filename, relativePath: `plans/${filename}` };
}
