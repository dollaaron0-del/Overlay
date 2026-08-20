/**
 * Minimal, dependency-free helpers for reading/writing the small subset of
 * Obsidian conventions this app needs (YAML frontmatter with string/array
 * values, inline #tags, [[wikilinks]]) — not a general YAML or Markdown
 * parser. Malformed or more complex frontmatter than we emit ourselves is
 * treated as "no frontmatter" rather than thrown as an error, since this is
 * used for a best-effort vault browser, never for anything security-critical.
 */

export type FrontmatterFields = Record<string, string | string[]>;

/** Serializes simple string/string-array fields as a `---\n...\n---\n` YAML block. */
export function buildFrontmatter(fields: FrontmatterFields): string {
  const lines: string[] = ["---"];
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) lines.push(`  - ${yamlScalar(item)}`);
    } else {
      lines.push(`${key}: ${yamlScalar(value)}`);
    }
  }
  lines.push("---", "");
  return lines.join("\n");
}

function yamlScalar(value: string): string {
  // Quote if it contains characters that would otherwise change YAML's
  // parsing (quotes, leading/trailing whitespace) — good enough for the
  // plain dates/tags/titles this app ever writes into frontmatter. A bare
  // colon (e.g. inside an ISO timestamp's "12:00:00") is fine unquoted —
  // YAML only treats ": " (colon followed by whitespace) or a trailing ":"
  // as the start of a new key, so only those two specifically force
  // quoting, not every colon.
  const hasAmbiguousColon = /: |:$/.test(value);
  if (/^[\w\-./: ]*$/.test(value) && value === value.trim() && value.length > 0 && !hasAmbiguousColon) {
    return value;
  }
  return `"${value.replace(/"/g, '\\"')}"`;
}

export interface ParsedNote {
  frontmatter: Record<string, string | string[]> | null;
  body: string;
}

/** Splits a note into its frontmatter (if present and parseable) and body. */
export function parseFrontmatter(content: string): ParsedNote {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
    return { frontmatter: null, body: content };
  }
  const end = content.indexOf("\n---", 4);
  if (end === -1) return { frontmatter: null, body: content };

  const block = content.slice(content.indexOf("\n") + 1, end);
  // `end` is the index of the "\n" right before the closing "---" — find the
  // newline that terminates *that* line (not the one we just matched) so the
  // body starts after the whole closing "---" line, not partway through it.
  const closingLineEnd = content.indexOf("\n", end + 1);
  const body = closingLineEnd === -1 ? "" : content.slice(closingLineEnd + 1);

  const frontmatter: Record<string, string | string[]> = {};
  const lines = block.split("\n");
  let currentKey: string | null = null;
  for (const rawLine of lines) {
    const listMatch = /^\s*-\s+(.*)$/.exec(rawLine);
    if (listMatch && currentKey) {
      const existing = frontmatter[currentKey];
      const value = unquote(listMatch[1]);
      frontmatter[currentKey] = Array.isArray(existing) ? [...existing, value] : [value];
      continue;
    }
    const kvMatch = /^([\w-]+):\s*(.*)$/.exec(rawLine);
    if (kvMatch) {
      currentKey = kvMatch[1];
      const value = kvMatch[2].trim();
      if (value) frontmatter[currentKey] = unquote(value);
      else frontmatter[currentKey] = []; // a list follows on the next lines
      continue;
    }
    // A line we don't understand — bail out rather than return partial/wrong data.
    if (rawLine.trim()) return { frontmatter: null, body: content };
  }
  return { frontmatter, body };
}

function unquote(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\"/g, '"');
  }
  return value;
}

const INLINE_TAG_PATTERN = /(?<![\w#])#([a-zA-Z][\w\-/]*)/g;

/** Tags from frontmatter's `tags` field plus inline #tags in the body (Obsidian's two tag sources). */
export function extractTags(content: string): string[] {
  const { frontmatter, body } = parseFrontmatter(content);
  const tags = new Set<string>();

  const fmTags = frontmatter?.tags;
  if (Array.isArray(fmTags)) {
    for (const t of fmTags) tags.add(t);
  } else if (typeof fmTags === "string") {
    for (const t of fmTags.split(/[,\s]+/).filter(Boolean)) tags.add(t);
  }

  for (const match of body.matchAll(INLINE_TAG_PATTERN)) {
    tags.add(match[1]);
  }

  return [...tags];
}

const WIKILINK_PATTERN = /\[\[([^\]|#]+)/g;

/** Note names referenced via [[Note Name]], [[Note Name|Alias]], or [[Note Name#Heading]]. */
export function extractWikilinks(content: string): string[] {
  const names = new Set<string>();
  for (const match of content.matchAll(WIKILINK_PATTERN)) {
    names.add(match[1].trim());
  }
  return [...names];
}

/** The first `# Heading` line, or the filename (without extension) as a fallback. */
export function deriveTitle(content: string, fallbackFilename: string): string {
  const { body } = parseFrontmatter(content);
  const heading = /^#\s+(.+)$/m.exec(body);
  if (heading) return heading[1].trim();
  return fallbackFilename.replace(/\.md$/, "");
}
