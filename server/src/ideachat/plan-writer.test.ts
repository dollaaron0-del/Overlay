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

// Stands in for the real `claude` CLI call — tests must not spend real API
// usage, and must verify the synthesis prompt is sent with the chat's own
// session id via --resume rather than the transcript being reassembled here.
function stubSynthesize(reply: string) {
  const calls: Array<{ message: string; cwd: string; sessionId: string | null }> = [];
  const fn = async (message: string, cwd: string, sessionId: string | null) => {
    calls.push({ message, cwd, sessionId });
    return { sessionId: sessionId ?? "new-session", reply };
  };
  return Object.assign(fn, { calls });
}

test("asks the model to synthesize the whole chat (via --resume) and writes the result under plans/", async () => {
  const chat = makeChat();
  const synth = stubSynthesize("1) Ausgangsidee: Dark Mode\n2) Ansatz: CSS-Variablen\n3) Schritte: ...\n4) Offene Fragen: keine");
  const { filename, relativePath } = await writeIdeaPlan(project, chat, synth);
  assert.match(filename, /\.md$/);
  assert.equal(relativePath, `plans/${filename}`);

  assert.equal(synth.calls.length, 1);
  assert.equal(synth.calls[0].sessionId, "sess-1");
  assert.equal(synth.calls[0].cwd, path.join(appsRoot, "demo-app"));
  assert.match(synth.calls[0].message, /Fasse das gesamte bisherige Gespräch/);

  const content = await fs.readFile(path.join(appsRoot, "demo-app", "plans", filename), "utf8");
  assert.match(content, /# Ideenplan: Dark Mode einbauen\?/);
  assert.match(content, /Ausgangsidee: Dark Mode/);
});

test("throws when the chat has no assistant reply yet, without calling the model", async () => {
  const chat = makeChat({ messages: [{ role: "user", text: "Nur eine Frage", at: new Date().toISOString() }] });
  const synth = stubSynthesize("sollte nie aufgerufen werden");
  await assert.rejects(() => writeIdeaPlan(project, chat, synth), /noch keine Antwort/);
  assert.equal(synth.calls.length, 0);
});

test("when Claude never took part (Ollama answered everything), the full transcript is sent inline to a fresh session", async () => {
  const chat = makeChat({
    claudeSessionId: null,
    messages: [
      { role: "user", text: "Sollten wir Dark Mode einbauen?", at: new Date().toISOString(), source: undefined },
      {
        role: "assistant",
        text: "Ja, klingt sinnvoll.",
        at: new Date().toISOString(),
        source: "ollama-ram",
      },
    ],
  });
  const synth = stubSynthesize("Zusammengefasster Plan");
  await writeIdeaPlan(project, chat, synth);

  assert.equal(synth.calls.length, 1);
  assert.equal(synth.calls[0].sessionId, null);
  assert.match(synth.calls[0].message, /Sollten wir Dark Mode einbauen\?/);
  assert.match(synth.calls[0].message, /Ja, klingt sinnvoll\./);
  assert.match(synth.calls[0].message, /Fasse das gesamte bisherige Gespräch/);
});

test("writing twice does not overwrite the previous plan file", async () => {
  const chat = makeChat();
  const synth = stubSynthesize("Erster Plan");
  const first = await writeIdeaPlan(project, chat, synth);
  await new Promise((r) => setTimeout(r, 5));
  const second = await writeIdeaPlan(project, chat, stubSynthesize("Zweiter Plan"));
  assert.notEqual(first.filename, second.filename);

  const plansDir = path.join(appsRoot, "demo-app", "plans");
  const files = await fs.readdir(plansDir);
  assert.ok(files.length >= 2);
});
