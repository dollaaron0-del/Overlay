import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { generateOllamaCompletion, OllamaUnavailableError } from "./ollama-client.js";

async function withMockServer(
  handler: http.RequestListener,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("expected a bound TCP address");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await run(baseUrl);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("parses a successful Ollama response", async () => {
  await withMockServer(
    (req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const parsed = JSON.parse(body);
        assert.equal(parsed.model, "llama3.1");
        assert.equal(parsed.stream, false);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ response: "Alles unauffällig." }));
      });
    },
    async (baseUrl) => {
      const text = await generateOllamaCompletion(baseUrl, "llama3.1", "prompt", 5000);
      assert.equal(text, "Alles unauffällig.");
    },
  );
});

test("throws a normal error on a non-2xx response", async () => {
  await withMockServer(
    (_req, res) => {
      res.writeHead(500);
      res.end("internal error");
    },
    async (baseUrl) => {
      await assert.rejects(() => generateOllamaCompletion(baseUrl, "llama3.1", "prompt", 5000), /500/);
    },
  );
});

test("throws when the response body is missing the expected field", async () => {
  await withMockServer(
    (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ unexpected: true }));
    },
    async (baseUrl) => {
      await assert.rejects(
        () => generateOllamaCompletion(baseUrl, "llama3.1", "prompt", 5000),
        /missing expected/,
      );
    },
  );
});

test("throws OllamaUnavailableError when nothing is listening", async () => {
  // Port 1 is a privileged, essentially always-closed port — nothing should
  // ever be listening there, giving a reliable connection-refused case.
  await assert.rejects(
    () => generateOllamaCompletion("http://127.0.0.1:1", "llama3.1", "prompt", 5000),
    OllamaUnavailableError,
  );
});

test("times out if the server never responds", async () => {
  await withMockServer(
    () => {
      // Never call res.end() — simulates a hung/overloaded Ollama instance.
    },
    async (baseUrl) => {
      await assert.rejects(
        () => generateOllamaCompletion(baseUrl, "llama3.1", "prompt", 200),
        /timed out/,
      );
    },
  );
});
