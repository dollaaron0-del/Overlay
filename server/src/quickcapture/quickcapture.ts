import fs from "node:fs/promises";
import path from "node:path";
import { resolveProjectDir } from "../projects/projects.registry.js";
import type { Project } from "../projects/projects.types.js";

export interface QuickCaptureInput {
  text?: string;
  link?: string;
  image?: { dataBase64: string; mimeType: string };
}

const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
};

/**
 * Appends one quick-capture entry to <project>/inbox.md (created on first
 * use), saving any image alongside under inbox-images/. The project's own
 * directory is already path-safe (resolveProjectDir only ever builds it
 * from APPS_ROOT + a dirName validated at registration time), and the image
 * filename here is derived purely from a sanitized timestamp plus a
 * validated extension — no client-supplied path segments reach the
 * filesystem.
 */
export async function appendQuickCapture(project: Project, input: QuickCaptureInput): Promise<void> {
  const projectDir = resolveProjectDir(project);
  const now = new Date();
  const isoStamp = now.toISOString();
  const heading = now.toLocaleString("de-DE");

  let imageMarkdown = "";
  if (input.image) {
    const ext = ALLOWED_IMAGE_TYPES[input.image.mimeType];
    if (!ext) {
      throw new Error(`Nicht unterstützter Bildtyp: ${input.image.mimeType}`);
    }
    const imagesDir = path.join(projectDir, "inbox-images");
    await fs.mkdir(imagesDir, { recursive: true });
    const filename = `${isoStamp.replace(/[:.]/g, "-")}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    await fs.writeFile(path.join(imagesDir, filename), Buffer.from(input.image.dataBase64, "base64"));
    imageMarkdown = `![Bild](inbox-images/${filename})`;
  }

  const parts = [`## ${heading}`];
  if (input.text) parts.push(input.text);
  if (input.link) parts.push(`Link: ${input.link}`);
  if (imageMarkdown) parts.push(imageMarkdown);
  parts.push("---");

  const entry = `${parts.join("\n\n")}\n\n`;
  await fs.appendFile(path.join(projectDir, "inbox.md"), entry, "utf8");
}
