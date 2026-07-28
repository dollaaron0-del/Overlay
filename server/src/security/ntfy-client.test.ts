import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { sendNtfyNotification } from "./ntfy-client.js";

async function withMockServer(
  handler: http.RequestListener,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("expected a bound TCP address");
  try {
    await run(`http://127.0.0.1:${address.port}/my-topic`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("posts the message body with title/priority/tags headers", async () => {
  await withMockServer(
    (req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        assert.equal(req.method, "POST");
        assert.equal(req.url, "/my-topic");
        assert.equal(req.headers["priority"], "urgent");
        assert.equal(req.headers["tags"], "warning");
        assert.equal(decodeURIComponent(req.headers["title"] as string), "Überschrift mit Umlaut");
        assert.equal(body, "Nachrichtentext");
        res.writeHead(200);
        res.end("ok");
      });
    },
    async (url) => {
      await sendNtfyNotification(url, "Überschrift mit Umlaut", "Nachrichtentext", "urgent");
    },
  );
});

test("throws on a non-2xx response", async () => {
  await withMockServer(
    (_req, res) => {
      res.writeHead(400);
      res.end("bad topic");
    },
    async (url) => {
      await assert.rejects(() => sendNtfyNotification(url, "t", "m"), /400/);
    },
  );
});

test("defaults to 'default' priority when not specified", async () => {
  await withMockServer(
    (req, res) => {
      assert.equal(req.headers["priority"], "default");
      res.writeHead(200);
      res.end();
    },
    async (url) => {
      await sendNtfyNotification(url, "t", "m");
    },
  );
});
