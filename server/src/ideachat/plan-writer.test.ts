import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Project } from "../projects/projects.types.js";
import type { IdeaChat } from "./ideachat.types.js";

// config.ts (APPS_ROOT) is a frozen singleton — import writeIdeaPlan
// dynamically, after setting env vars, not statically at the top.
let tmpCwd: string;
let originalCwd: string;
let appsRoot: string;
let writeIdeaPlan: typeof import("./plan-writer.js").writeIdeaPlan;
let slugify: typeof import("./plan-writer.js").slugify;

const project: Project = {
  id: "demo-app",
  dirName: "demo-app",
  pm2Name: "demo-app",
  startScript: "npm start",
};

function makeChat(overrides: Partial<IdeaChat> = {}): IdeaChat {
  const now = new Date().toISOString();
  return {
    id: "chat-1",
    projectId: "demo-app",
    title: "Dark Mode einbauen?",
    claudeSessionId: "sess-1",
    messages: [
      { role: "user", text: "Sollten wir Dark Mode einbauen?", at: now },
      { role: "assistant", text: "Ja, das ist sinnvoll. Hier ist ein Plan:\n1. CSS-Variablen...", at: now },
    ],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

before(async () => {
  originalCwd = process.cwd();
  tmpCwd = await fs.mkdtemp(path.join(os.tmpdir(), "overlay-planwriter-test-"));
  process.chdir(tmpCwd);

  appsRoot = path.join(tmpCwd, "apps-root");
  await fs.mkdir(path.join(appsRoot, "demo-app"), { recursive: true });

  process.env.APPS_ROOT = appsRoot;
  process.env.SESSION_SECRET = "test-session-secret-not-for-prod";
  process.env.ADMIN_USERNAME = "admin";
  process.env.ADMIN_PASSWORD_HASH = "$2b$04$0000000000000000000000000000000000000000000000000000";

  ({ writeIdeaPlan, slugify } = await import("./plan-writer.js"));
});

after(async () => {
  process.chdir(originalCwd);
  await fs.rm(tmpCwd, { recursive: true, force: true });
});

test("slugify produces a safe, lowercase, dash-separated slug", () => {
  assert.equal(slugify("Dark Mode einbauen?"), "dark-mode-einbauen");
  assert.equal(slugify("../../etc/passwd"), "etc-passwd");
  assert.equal(slugify("   "), "idee");
  assert.equal(slugify(""), "idee");
});

test("writes the last assistant reply as a new markdown file under plans/", async () => {
  const chat = makeChat();
  const { filename, relativePath } = await writeIdeaPlan(project, chat);
  assert.match(filename, /\.md$/);
  assert.equal(relativePath, `plans/${filename}`);

  const content = await fs.readFile(path.join(appsRoot, "demo-app", "plans", filename), "utf8");
  assert.match(content, /# Ideenplan: Dark Mode einbauen\?/);
  assert.match(content, /Sollten wir Dark Mode einbauen\?/);
  assert.match(content, /Hier ist ein Plan:/);
});

test("throws when the chat has no assistant reply yet", async () => {
  const chat = makeChat({ messages: [{ role: "user", text: "Nur eine Frage", at: new Date().toISOString() }] });
  await assert.rejects(() => writeIdeaPlan(project, chat), /noch keine Antwort/);
});

test("writing twice does not overwrite the previous plan file", async () => {
  const chat = makeChat();
  const first = await writeIdeaPlan(project, chat);
  await new Promise((r) => setTimeout(r, 5));
  const second = await writeIdeaPlan(project, { ...chat, messages: [...chat.messages, { role: "assistant", text: "Zweite Antwort", at: new Date().toISOString() }] });
  assert.notEqual(first.filename, second.filename);

  const plansDir = path.join(appsRoot, "demo-app", "plans");
  const files = await fs.readdir(plansDir);
  assert.ok(files.length >= 2);
});
