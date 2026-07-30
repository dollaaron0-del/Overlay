import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

async function withMockServer(
  handler: http.RequestListener,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("expected a bound TCP address");
  try {
    await run(`http://127.0.0.1:${address.port}/webhook`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

// config.ts (OPENCLAW_WEBHOOK_URL) is a frozen singleton evaluated at first
// import — set env vars and import this module dynamically, not statically.
// The "disabled" (no URL configured) and "unreachable" (webhook errors)
// scenarios each need their own env, so they live in separate sibling test
// files (own process), same pattern as cli-helpers.test.ts / .disabled.test.ts.
let tmpCwd: string;
let originalCwd: string;
let sendOpenClawNotification: typeof import("./openclaw-webhook.js").sendOpenClawNotification;
let notifyOpenClawIfConfigured: typeof import("./openclaw-webhook.js").notifyOpenClawIfConfigured;
let webhookUrl: string;
let receivedBodies: string[];
let mockServer: http.Server;

before(async () => {
  receivedBodies = [];
  mockServer = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      receivedBodies.push(body);
      res.writeHead(200);
      res.end("ok");
    });
  });
  await new Promise<void>((resolve) => mockServer.listen(0, "127.0.0.1", resolve));
  const address = mockServer.address();
  if (!address || typeof address === "string") throw new Error("expected a bound TCP address");
  webhookUrl = `http://127.0.0.1:${address.port}/webhook`;

  originalCwd = process.cwd();
  tmpCwd = await fs.mkdtemp(path.join(os.tmpdir(), "overlay-openclaw-test-"));
  process.chdir(tmpCwd);

  process.env.APPS_ROOT = path.join(tmpCwd, "apps-root");
  process.env.SESSION_SECRET = "test-session-secret-not-for-prod";
  process.env.ADMIN_USERNAME = "admin";
  process.env.ADMIN_PASSWORD_HASH = "$2b$04$0000000000000000000000000000000000000000000000000000";
  process.env.OPENCLAW_WEBHOOK_URL = webhookUrl;
  process.env.OPENCLAW_WEBHOOK_SECRET = "";

  ({ sendOpenClawNotification, notifyOpenClawIfConfigured } = await import("./openclaw-webhook.js"));
});

after(async () => {
  process.chdir(originalCwd);
  await fs.rm(tmpCwd, { recursive: true, force: true });
  await new Promise<void>((resolve) => mockServer.close(() => resolve()));
});

test("posts a {text} JSON payload with a Bearer auth header", async () => {
  await withMockServer(
    (req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        assert.equal(req.method, "POST");
        assert.equal(req.headers["content-type"], "application/json");
        assert.equal(req.headers["authorization"], "Bearer my-secret");
        assert.deepEqual(JSON.parse(body), { text: "Kritischer Fund im Scan" });
        res.writeHead(200);
        res.end("ok");
      });
    },
    async (url) => {
      await sendOpenClawNotification(url, "my-secret", "Kritischer Fund im Scan");
    },
  );
});

test("omits the Authorization header when no secret is configured", async () => {
  await withMockServer(
    (req, res) => {
      assert.equal(req.headers["authorization"], undefined);
      res.writeHead(200);
      res.end();
    },
    async (url) => {
      await sendOpenClawNotification(url, "", "Nachricht ohne Secret");
    },
  );
});

test("throws on a non-2xx response", async () => {
  await withMockServer(
    (_req, res) => {
      res.writeHead(500);
      res.end("gateway unreachable");
    },
    async (url) => {
      await assert.rejects(() => sendOpenClawNotification(url, "", "m"), /500/);
    },
  );
});

test("notifyOpenClawIfConfigured sends the text to the configured webhook", async () => {
  await notifyOpenClawIfConfigured("Backup fehlgeschlagen");
  assert.deepEqual(JSON.parse(receivedBodies[receivedBodies.length - 1]), { text: "Backup fehlgeschlagen" });
});
