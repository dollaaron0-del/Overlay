import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { listNotes, getNote } from "./vault-index.js";

let tmpCwd: string;
let projectDir: string;

before(async () => {
  tmpCwd = await fs.mkdtemp(path.join(os.tmpdir(), "overlay-vault-index-test-"));
  projectDir = path.join(tmpCwd, "vault");
  await fs.mkdir(path.join(projectDir, "notes"), { recursive: true });
  await fs.mkdir(path.join(projectDir, "node_modules", "somepkg"), { recursive: true });

  await fs.writeFile(
    path.join(projectDir, "Second Brain.md"),
    "---\ntags:\n  - hub\ncreated: 2026-01-01\n---\n\n# Second Brain\n\nSiehe [[Projekt Idee]] und [[notes/Detail]].\n",
    "utf8",
  );
  await fs.writeFile(
    path.join(projectDir, "notes", "Projekt Idee.md"),
    "# Projekt Idee\n\nEine #idee mit Bezug zu [[Second Brain]].\n",
    "utf8",
  );
  await fs.writeFile(path.join(projectDir, "notes", "Detail.md"), "Nur ein Detail ohne Links.\n", "utf8");
  await fs.writeFile(path.join(projectDir, "node_modules", "somepkg", "README.md"), "# Ignoriert\n", "utf8");
});

after(async () => {
  await fs.rm(tmpCwd, { recursive: true, force: true });
});

test("listNotes finds all markdown files recursively, ignoring node_modules", async () => {
  const notes = await listNotes(projectDir);
  const paths = notes.map((n) => n.path).sort();
  assert.deepEqual(paths, ["Second Brain.md", "notes/Detail.md", "notes/Projekt Idee.md"]);
});

test("listNotes extracts titles and tags per note", async () => {
  const notes = await listNotes(projectDir);
  const hub = notes.find((n) => n.path === "Second Brain.md")!;
  assert.equal(hub.title, "Second Brain");
  assert.deepEqual(hub.tags, ["hub"]);

  const idea = notes.find((n) => n.path === "notes/Projekt Idee.md")!;
  assert.equal(idea.title, "Projekt Idee");
  assert.deepEqual(idea.tags, ["idee"]);
});

test("getNote returns frontmatter, body and wikilinks for an existing note", async () => {
  const note = await getNote(projectDir, "Second Brain.md");
  assert.ok(note);
  assert.equal(note!.title, "Second Brain");
  assert.deepEqual(note!.frontmatter, { tags: ["hub"], created: "2026-01-01" });
  assert.match(note!.body, /Siehe \[\[Projekt Idee\]\]/);
  assert.deepEqual(note!.wikilinks, ["Projekt Idee", "notes/Detail"]);
});

test("getNote resolves backlinks by note name, regardless of path prefix", async () => {
  const note = await getNote(projectDir, "notes/Detail.md");
  assert.ok(note);
  assert.deepEqual(note!.backlinks, ["Second Brain.md"]);
});

test("getNote resolves backlinks the other direction too", async () => {
  const note = await getNote(projectDir, "Second Brain.md");
  assert.ok(note);
  assert.deepEqual(note!.backlinks, ["notes/Projekt Idee.md"]);
});

test("getNote returns null for a path outside the project", async () => {
  const note = await getNote(projectDir, "../../etc/passwd.md");
  assert.equal(note, null);
});

test("getNote returns null for a non-markdown path", async () => {
  const note = await getNote(projectDir, "package.json");
  assert.equal(note, null);
});

test("getNote returns null for a note that doesn't exist", async () => {
  const note = await getNote(projectDir, "notes/Nichts.md");
  assert.equal(note, null);
});
