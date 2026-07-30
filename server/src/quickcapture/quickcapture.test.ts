import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Project } from "../projects/projects.types.js";

// config.ts (APPS_ROOT) is a frozen singleton — import appendQuickCapture
// dynamically, after setting env vars, not statically at the top.
let tmpCwd: string;
let originalCwd: string;
let appsRoot: string;
let appendQuickCapture: typeof import("./quickcapture.js").appendQuickCapture;

const project: Project = {
  id: "demo-app",
  dirName: "demo-app",
  pm2Name: "demo-app",
  startScript: "npm start",
};

/** Obsidian-mode tests each get their own project dir so file-count/existence assertions aren't polluted by other tests sharing `project`. */
async function makeFreshProject(dirName: string): Promise<Project> {
  await fs.mkdir(path.join(appsRoot, dirName), { recursive: true });
  return { id: dirName, dirName, pm2Name: dirName, startScript: "npm start" };
}

before(async () => {
  originalCwd = process.cwd();
  tmpCwd = await fs.mkdtemp(path.join(os.tmpdir(), "overlay-quickcapture-test-"));
  process.chdir(tmpCwd);

  appsRoot = path.join(tmpCwd, "apps-root");
  await fs.mkdir(path.join(appsRoot, "demo-app"), { recursive: true });

  process.env.APPS_ROOT = appsRoot;
  process.env.SESSION_SECRET = "test-session-secret-not-for-prod";
  process.env.ADMIN_USERNAME = "admin";
  process.env.ADMIN_PASSWORD_HASH = "$2b$04$0000000000000000000000000000000000000000000000000000";

  ({ appendQuickCapture } = await import("./quickcapture.js"));
});

after(async () => {
  process.chdir(originalCwd);
  await fs.rm(tmpCwd, { recursive: true, force: true });
});

test("appends a text-only entry to inbox.md, creating it on first use", async () => {
  await appendQuickCapture(project, { text: "Eine spontane Idee" }, false);
  const content = await fs.readFile(path.join(appsRoot, "demo-app", "inbox.md"), "utf8");
  assert.match(content, /Eine spontane Idee/);
  assert.match(content, /^## /m);
});

test("appends a link", async () => {
  await appendQuickCapture(project, { link: "https://example.com/article" }, false);
  const content = await fs.readFile(path.join(appsRoot, "demo-app", "inbox.md"), "utf8");
  assert.match(content, /Link: https:\/\/example\.com\/article/);
});

test("saves an image alongside and references it from inbox.md", async () => {
  const tinyPngBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  await appendQuickCapture(project, { image: { dataBase64: tinyPngBase64, mimeType: "image/png" } }, false);

  const content = await fs.readFile(path.join(appsRoot, "demo-app", "inbox.md"), "utf8");
  const match = /!\[Bild\]\(inbox-images\/([^)]+)\)/.exec(content);
  assert.ok(match, "expected an image reference in inbox.md");

  const savedImage = await fs.readFile(path.join(appsRoot, "demo-app", "inbox-images", match[1]));
  assert.equal(savedImage.toString("base64"), tinyPngBase64);
});

test("rejects an unsupported image type without writing anything", async () => {
  await assert.rejects(
    () => appendQuickCapture(project, { image: { dataBase64: "AAAA", mimeType: "image/gif" } }, false),
    /Nicht unterstützter Bildtyp/,
  );
});

test("multiple entries append rather than overwrite", async () => {
  await appendQuickCapture(project, { text: "Erste Notiz" }, false);
  await appendQuickCapture(project, { text: "Zweite Notiz" }, false);
  const content = await fs.readFile(path.join(appsRoot, "demo-app", "inbox.md"), "utf8");
  assert.match(content, /Erste Notiz/);
  assert.match(content, /Zweite Notiz/);
  assert.equal(content.split("---").length - 1 >= 2, true);
});

test("Obsidian mode: creates an atomic note under inbox/ with YAML frontmatter, not inbox.md", async () => {
  const obsidianProject = await makeFreshProject("obsidian-atomic");
  await appendQuickCapture(obsidianProject, { text: "Eine Idee für den Obsidian-Modus" }, true);

  await assert.rejects(() => fs.access(path.join(appsRoot, "obsidian-atomic", "inbox.md")));

  const files = await fs.readdir(path.join(appsRoot, "obsidian-atomic", "inbox"));
  assert.equal(files.length, 1);
  const content = await fs.readFile(path.join(appsRoot, "obsidian-atomic", "inbox", files[0]), "utf8");
  assert.match(content, /^---\ntags:\n {2}- inbox\n {2}- schnellnotiz\ncreated: .+\n---\n/);
  assert.match(content, /Eine Idee für den Obsidian-Modus/);
});

test("Obsidian mode: each capture is its own file, not appended to a shared one", async () => {
  const obsidianProject = await makeFreshProject("obsidian-multi");
  await appendQuickCapture(obsidianProject, { text: "Erste Obsidian-Notiz" }, true);
  await appendQuickCapture(obsidianProject, { text: "Zweite Obsidian-Notiz" }, true);
  const files = await fs.readdir(path.join(appsRoot, "obsidian-multi", "inbox"));
  assert.equal(files.filter((f) => f.endsWith(".md")).length, 2);
});

test("Obsidian mode: saves an image next to the note and embeds it via ![[...]]", async () => {
  const obsidianProject = await makeFreshProject("obsidian-image");
  const tinyPngBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  await appendQuickCapture(obsidianProject, { text: "Notiz mit Bild", image: { dataBase64: tinyPngBase64, mimeType: "image/png" } }, true);

  const inboxDir = path.join(appsRoot, "obsidian-image", "inbox");
  const files = await fs.readdir(inboxDir);
  const noteFile = files.find((f) => f.endsWith(".md"))!;
  const content = await fs.readFile(path.join(inboxDir, noteFile), "utf8");
  const match = /!\[\[([^\]]+)\]\]/.exec(content);
  assert.ok(match, "expected an Obsidian image embed in the note");

  const savedImage = await fs.readFile(path.join(inboxDir, match[1]));
  assert.equal(savedImage.toString("base64"), tinyPngBase64);
});

test("Obsidian mode: rejects an unsupported image type without writing anything", async () => {
  const obsidianProject = await makeFreshProject("obsidian-badimage");
  await assert.rejects(
    () => appendQuickCapture(obsidianProject, { image: { dataBase64: "AAAA", mimeType: "image/gif" } }, true),
    /Nicht unterstützter Bildtyp/,
  );
});
