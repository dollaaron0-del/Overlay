import fs from "node:fs/promises";
import path from "node:path";
import { resolveProjectDir } from "../projects/projects.registry.js";
import type { Project } from "../projects/projects.types.js";
import type { IdeaChatAttachment } from "./ideachat.types.js";

const ALLOWED_TYPES: Record<string, { ext: string; kind: "image" | "document" }> = {
  "image/jpeg": { ext: "jpg", kind: "image" },
  "image/png": { ext: "png", kind: "image" },
  "image/webp": { ext: "webp", kind: "image" },
  "image/heic": { ext: "heic", kind: "image" },
  "application/pdf": { ext: "pdf", kind: "document" },
  "text/plain": { ext: "txt", kind: "document" },
  "text/markdown": { ext: "md", kind: "document" },
  "application/msword": { ext: "doc", kind: "document" },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { ext: "docx", kind: "document" },
};

// Per-file cap; the route's overall body-size limit (server.ts) covers the
// base64 overhead for a whole request of several files at once.
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

export interface AttachmentInput {
  dataBase64: string;
  mimeType: string;
  originalName: string;
}

/** Where a chat's attachments live — inside the project's own directory, like quick-capture's inbox-images. */
export function attachmentsDir(project: Project, chatId: string): string {
  return path.join(resolveProjectDir(project), "idea-attachments", chatId);
}

/**
 * Saves each attachment under <project>/idea-attachments/<chatId>/ with a
 * filename built purely from a sanitized timestamp, a random suffix, and a
 * validated extension — never the client-supplied name — same convention as
 * quick-capture's inbox images. originalName is stored only for display.
 */
export async function saveIdeaChatAttachments(
  project: Project,
  chatId: string,
  inputs: AttachmentInput[],
): Promise<IdeaChatAttachment[]> {
  if (inputs.length === 0) return [];
  const dir = attachmentsDir(project, chatId);
  await fs.mkdir(dir, { recursive: true });

  const saved: IdeaChatAttachment[] = [];
  for (const input of inputs) {
    const type = ALLOWED_TYPES[input.mimeType];
    if (!type) {
      throw new Error(`Nicht unterstützter Dateityp: ${input.mimeType}`);
    }
    const buffer = Buffer.from(input.dataBase64, "base64");
    if (buffer.byteLength > MAX_ATTACHMENT_BYTES) {
      throw new Error(`Datei zu groß: ${input.originalName}`);
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `${stamp}-${Math.random().toString(36).slice(2, 8)}.${type.ext}`;
    await fs.writeFile(path.join(dir, filename), buffer);
    saved.push({ filename, originalName: input.originalName, mimeType: input.mimeType, kind: type.kind });
  }
  return saved;
}
