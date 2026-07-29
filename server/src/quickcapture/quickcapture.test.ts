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
  await appendQuickCapture(project, { text: "Eine spontane Idee" });
  const content = await fs.readFile(path.join(appsRoot, "demo-app", "inbox.md"), "utf8");
  assert.match(content, /Eine spontane Idee/);
  assert.match(content, /^## /m);
});

test("appends a link", async () => {
  await appendQuickCapture(project, { link: "https://example.com/article" });
  const content = await fs.readFile(path.join(appsRoot, "demo-app", "inbox.md"), "utf8");
  assert.match(content, /Link: https:\/\/example\.com\/article/);
});

test("saves an image alongside and references it from inbox.md", async () => {
  const tinyPngBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  await appendQuickCapture(project, { image: { dataBase64: tinyPngBase64, mimeType: "image/png" } });

  const content = await fs.readFile(path.join(appsRoot, "demo-app", "inbox.md"), "utf8");
  const match = /!\[Bild\]\(inbox-images\/([^)]+)\)/.exec(content);
  assert.ok(match, "expected an image reference in inbox.md");

  const savedImage = await fs.readFile(path.join(appsRoot, "demo-app", "inbox-images", match[1]));
  assert.equal(savedImage.toString("base64"), tinyPngBase64);
});

test("rejects an unsupported image type without writing anything", async () => {
  await assert.rejects(
    () => appendQuickCapture(project, { image: { dataBase64: "AAAA", mimeType: "image/gif" } }),
    /Nicht unterstützter Bildtyp/,
  );
});

test("multiple entries append rather than overwrite", async () => {
  await appendQuickCapture(project, { text: "Erste Notiz" });
  await appendQuickCapture(project, { text: "Zweite Notiz" });
  const content = await fs.readFile(path.join(appsRoot, "demo-app", "inbox.md"), "utf8");
  assert.match(content, /Erste Notiz/);
  assert.match(content, /Zweite Notiz/);
  assert.equal(content.split("---").length - 1 >= 2, true);
});
