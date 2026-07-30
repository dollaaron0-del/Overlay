import fs from "node:fs/promises";
import path from "node:path";
import { resolveSafePath, UnsafePathError } from "../files/safe-path.js";
import { parseFrontmatter, extractTags, extractWikilinks, deriveTitle } from "./obsidian-note.js";

export interface NoteSummary {
  path: string;
  title: string;
  tags: string[];
}

export interface NoteDetail extends NoteSummary {
  frontmatter: Record<string, string | string[]> | null;
  body: string;
  wikilinks: string[];
  backlinks: string[];
}

interface IndexedNote extends NoteSummary {
  wikilinks: string[];
}

const IGNORED_DIRS = new Set(["node_modules", ".git"]);

async function findMarkdownFiles(dir: string, root: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      results.push(...(await findMarkdownFiles(path.join(dir, entry.name), root)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      results.push(path.relative(root, path.join(dir, entry.name)).split(path.sep).join("/"));
    }
  }
  return results;
}

async function buildIndex(projectDir: string): Promise<IndexedNote[]> {
  const files = await findMarkdownFiles(projectDir, projectDir);
  const notes: IndexedNote[] = [];
  for (const relPath of files) {
    const content = await fs.readFile(path.join(projectDir, relPath), "utf8");
    notes.push({
      path: relPath,
      title: deriveTitle(content, path.posix.basename(relPath)),
      tags: extractTags(content),
      wikilinks: extractWikilinks(content),
    });
  }
  return notes.sort((a, b) => a.path.localeCompare(b.path));
}

/** Obsidian resolves a wikilink by note name anywhere in the vault, not just by relative path. */
function resolvesTo(index: IndexedNote[], linkText: string, notePath: string): boolean {
  const target = linkText.trim().toLowerCase();
  const note = index.find((n) => n.path === notePath);
  if (!note) return false;
  const base = path.posix.basename(note.path, ".md").toLowerCase();
  return target === base || target === note.path.toLowerCase() || `${target}.md` === note.path.toLowerCase();
}

export async function listNotes(projectDir: string): Promise<NoteSummary[]> {
  const index = await buildIndex(projectDir);
  return index.map(({ path: p, title, tags }) => ({ path: p, title, tags }));
}

/** Returns null if notePath doesn't resolve to an existing .md file inside the project. */
export async function getNote(projectDir: string, notePath: string): Promise<NoteDetail | null> {
  if (!notePath.endsWith(".md")) return null;

  let absPath: string;
  try {
    absPath = await resolveSafePath(projectDir, notePath);
  } catch (err) {
    if (err instanceof UnsafePathError) return null;
    throw err;
  }

  let content: string;
  try {
    content = await fs.readFile(absPath, "utf8");
  } catch {
    return null;
  }

  const index = await buildIndex(projectDir);
  const { frontmatter, body } = parseFrontmatter(content);
  const backlinks = index
    .filter((n) => n.path !== notePath && n.wikilinks.some((link) => resolvesTo(index, link, notePath)))
    .map((n) => n.path);

  return {
    path: notePath,
    title: deriveTitle(content, path.posix.basename(notePath)),
    tags: extractTags(content),
    frontmatter,
    body,
    wikilinks: extractWikilinks(content),
    backlinks,
  };
}
