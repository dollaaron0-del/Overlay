import fs from "node:fs/promises";
import path from "node:path";
import type { EmmyAttachment } from "@overlay/shared";

// Known types get a clean, fixed extension + kind. Anything else is still
// accepted (kind "document") because Emmy runs on the same box and can open
// whatever lands here with its own tools — the point is to let Aaron send "all
// kinds of files", not to gatekeep. The stored filename is always
// server-generated, never the client name, so a weird type can't smuggle a
// path or an executable-looking name into the tree.
const KNOWN_TYPES: Record<string, { ext: string; kind: "image" | "document" }> = {
  "image/jpeg": { ext: "jpg", kind: "image" },
  "image/png": { ext: "png", kind: "image" },
  "image/webp": { ext: "webp", kind: "image" },
  "image/gif": { ext: "gif", kind: "image" },
  "image/heic": { ext: "heic", kind: "image" },
  "application/pdf": { ext: "pdf", kind: "document" },
  "text/plain": { ext: "txt", kind: "document" },
  "text/markdown": { ext: "md", kind: "document" },
  "text/csv": { ext: "csv", kind: "document" },
  "application/json": { ext: "json", kind: "document" },
  "application/msword": { ext: "doc", kind: "document" },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { ext: "docx", kind: "document" },
  "application/vnd.ms-excel": { ext: "xls", kind: "document" },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { ext: "xlsx", kind: "document" },
  "application/vnd.ms-powerpoint": { ext: "ppt", kind: "document" },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": { ext: "pptx", kind: "document" },
  "application/zip": { ext: "zip", kind: "document" },
  "application/gzip": { ext: "gz", kind: "document" },
};

// Per-file cap; the route's overall body-size limit (server.ts) covers the
// base64 overhead of several files in one request.
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export interface AttachmentInput {
  dataBase64: string;
  mimeType: string;
  originalName: string;
}

/** Where a chat's attachments live: data/emmy-attachments/<chatId>/. */
export function attachmentsDir(chatId: string): string {
  return path.join(process.cwd(), "data", "emmy-attachments", chatId);
}

/** Derives a safe extension from the client name for unknown types: alnum only, max 8 chars, "bin" fallback. */
function safeExtFromName(originalName: string): string {
  const raw = path.extname(originalName).replace(/^\./, "").toLowerCase();
  const cleaned = raw.replace(/[^a-z0-9]/g, "").slice(0, 8);
  return cleaned || "bin";
}

export async function saveEmmyAttachments(chatId: string, inputs: AttachmentInput[]): Promise<EmmyAttachment[]> {
  if (inputs.length === 0) return [];
  const dir = attachmentsDir(chatId);
  await fs.mkdir(dir, { recursive: true });

  const saved: EmmyAttachment[] = [];
  for (const input of inputs) {
    const known = KNOWN_TYPES[input.mimeType];
    const ext = known?.ext ?? safeExtFromName(input.originalName);
    const kind: "image" | "document" = known?.kind ?? (input.mimeType.startsWith("image/") ? "image" : "document");

    const buffer = Buffer.from(input.dataBase64, "base64");
    if (buffer.byteLength > MAX_ATTACHMENT_BYTES) {
      throw new Error(`Datei zu groß: ${input.originalName}`);
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `${stamp}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    await fs.writeFile(path.join(dir, filename), buffer);
    saved.push({ filename, originalName: input.originalName, mimeType: input.mimeType, kind });
  }
  return saved;
}
