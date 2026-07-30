import fs from "node:fs/promises";
import path from "node:path";
import { resolveProjectDir } from "../projects/projects.registry.js";
import type { Project } from "../projects/projects.types.js";
import { buildFrontmatter } from "../obsidian/obsidian-note.js";
import { slugify } from "../util/slug.js";

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

/** Saves the image into `imagesDir` and returns its filename, or "" if there's no image. */
async function saveImageIfAny(imagesDir: string, image: QuickCaptureInput["image"], isoStamp: string): Promise<string> {
  if (!image) return "";
  const ext = ALLOWED_IMAGE_TYPES[image.mimeType];
  if (!ext) {
    throw new Error(`Nicht unterstützter Bildtyp: ${image.mimeType}`);
  }
  await fs.mkdir(imagesDir, { recursive: true });
  const filename = `${isoStamp}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  await fs.writeFile(path.join(imagesDir, filename), Buffer.from(image.dataBase64, "base64"));
  return filename;
}

/**
 * Appends one quick-capture entry to <project>/inbox.md (created on first
 * use), saving any image alongside under inbox-images/. The project's own
 * directory is already path-safe (resolveProjectDir only ever builds it
 * from APPS_ROOT + a dirName validated at registration time), and the image
 * filename here is derived purely from a sanitized timestamp plus a
 * validated extension — no client-supplied path segments reach the
 * filesystem.
 */
async function appendToInboxFile(project: Project, input: QuickCaptureInput): Promise<void> {
  const projectDir = resolveProjectDir(project);
  const now = new Date();
  const isoStamp = now.toISOString().replace(/[:.]/g, "-");
  const heading = now.toLocaleString("de-DE");

  const imageFilename = await saveImageIfAny(path.join(projectDir, "inbox-images"), input.image, isoStamp);

  const parts = [`## ${heading}`];
  if (input.text) parts.push(input.text);
  if (input.link) parts.push(`Link: ${input.link}`);
  if (imageFilename) parts.push(`![Bild](inbox-images/${imageFilename})`);
  parts.push("---");

  const entry = `${parts.join("\n\n")}\n\n`;
  await fs.appendFile(path.join(projectDir, "inbox.md"), entry, "utf8");
}

/**
 * Obsidian mode: each capture becomes its own atomic note under
 * <project>/inbox/, with YAML frontmatter — the idiomatic Obsidian/Second-
 * Brain pattern (one linkable, taggable node per thought) instead of one
 * ever-growing file a graph view can't usefully break apart. Filename is
 * built purely from a sanitized timestamp and a slugified excerpt (see
 * slugify) — never a raw client-supplied path segment. Any image is saved
 * next to the note (Obsidian's usual "attachments live with the note"
 * convention) and embedded via ![[filename]].
 */
async function writeAtomicObsidianNote(project: Project, input: QuickCaptureInput): Promise<void> {
  const projectDir = resolveProjectDir(project);
  const now = new Date();
  const isoStamp = now.toISOString().replace(/[:.]/g, "-");
  const inboxDir = path.join(projectDir, "inbox");

  const imageFilename = await saveImageIfAny(inboxDir, input.image, isoStamp);

  const titleSource = input.text || input.link || "Schnellnotiz";
  const frontmatter = buildFrontmatter({ tags: ["inbox", "schnellnotiz"], created: now.toISOString() });

  const parts: string[] = [];
  if (input.text) parts.push(input.text);
  if (input.link) parts.push(`Link: ${input.link}`);
  if (imageFilename) parts.push(`![[${imageFilename}]]`);

  const content = `${frontmatter}\n${parts.join("\n\n")}\n`;
  const filename = `${isoStamp}-${slugify(titleSource, "schnellnotiz")}.md`;

  await fs.mkdir(inboxDir, { recursive: true });
  await fs.writeFile(path.join(inboxDir, filename), content, "utf8");
}

export async function appendQuickCapture(project: Project, input: QuickCaptureInput, obsidianMode: boolean): Promise<void> {
  if (obsidianMode) {
    await writeAtomicObsidianNote(project, input);
  } else {
    await appendToInboxFile(project, input);
  }
}
