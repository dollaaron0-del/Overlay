import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFrontmatter, parseFrontmatter, extractTags, extractWikilinks, deriveTitle } from "./obsidian-note.js";

test("buildFrontmatter serializes scalar and array fields", () => {
  const fm = buildFrontmatter({ created: "2026-07-30T12:00:00.000Z", tags: ["inbox", "schnellnotiz"] });
  assert.equal(
    fm,
    "---\ncreated: 2026-07-30T12:00:00.000Z\ntags:\n  - inbox\n  - schnellnotiz\n---\n",
  );
});

test("buildFrontmatter quotes values containing YAML-significant characters", () => {
  const fm = buildFrontmatter({ title: "Idee: Dark Mode?" });
  assert.match(fm, /title: "Idee: Dark Mode\?"/);
});

test("parseFrontmatter round-trips what buildFrontmatter writes", () => {
  const fm = buildFrontmatter({ created: "2026-07-30", tags: ["a", "b"] });
  const note = `${fm}\n# Hello\n\nBody text.`;
  const { frontmatter, body } = parseFrontmatter(note);
  assert.deepEqual(frontmatter, { created: "2026-07-30", tags: ["a", "b"] });
  assert.equal(body.trim(), "# Hello\n\nBody text.");
});

test("parseFrontmatter returns null frontmatter (and the whole content as body) when there is none", () => {
  const { frontmatter, body } = parseFrontmatter("# Just a note\n\nNo frontmatter here.");
  assert.equal(frontmatter, null);
  assert.equal(body, "# Just a note\n\nNo frontmatter here.");
});

test("parseFrontmatter bails out gracefully on frontmatter it can't understand, rather than throwing", () => {
  const note = '---\nnested:\n  deeper: value\n---\n\nBody.';
  const { frontmatter } = parseFrontmatter(note);
  assert.equal(frontmatter, null);
});

test("extractTags collects from frontmatter array, frontmatter string, and inline #tags, deduplicated", () => {
  const note = buildFrontmatter({ tags: ["inbox", "idee"] }) + "\n\nText mit #inline-tag und nochmal #inbox.";
  const tags = extractTags(note);
  assert.deepEqual([...tags].sort(), ["idee", "inbox", "inline-tag"]);
});

test("extractTags does not mistake a markdown heading for a tag", () => {
  const tags = extractTags("# Heading\n\nSome text without any real tags.");
  assert.deepEqual(tags, []);
});

test("extractTags handles a comma-separated frontmatter string", () => {
  const note = "---\ntags: foo, bar\n---\n\nBody";
  assert.deepEqual(extractTags(note).sort(), ["bar", "foo"]);
});

test("extractWikilinks captures plain links, aliased links, and heading links, deduplicated", () => {
  const links = extractWikilinks("See [[Note A]] and [[Note B|Alias]] and [[Note A#Section]].");
  assert.deepEqual(links.sort(), ["Note A", "Note B"]);
});

test("extractWikilinks returns an empty array when there are none", () => {
  assert.deepEqual(extractWikilinks("Just plain text."), []);
});

test("deriveTitle uses the first heading", () => {
  assert.equal(deriveTitle("# Meine Idee\n\nText.", "2026-fallback.md"), "Meine Idee");
});

test("deriveTitle falls back to the filename (without extension) when there's no heading", () => {
  assert.equal(deriveTitle("Just text, no heading.", "2026-07-30-meine-notiz.md"), "2026-07-30-meine-notiz");
});

test("deriveTitle looks past frontmatter for the heading", () => {
  const note = buildFrontmatter({ tags: ["x"] }) + "\n# Echter Titel\n\nText.";
  assert.equal(deriveTitle(note, "fallback.md"), "Echter Titel");
});
