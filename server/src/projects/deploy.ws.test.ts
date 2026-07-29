import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { DeployServerMessage } from "@overlay/shared";
import { handleDeployConnection } from "./deploy.ws.js";
import { startDeployRun, recordDeployLine, endDeployRun } from "./deploy-log-bus.js";

// A minimal stand-in for the `ws` WebSocket instance — just enough of the
// surface handleDeployConnection actually touches (readyState/OPEN, send, on/close).
function fakeSocket() {
  const emitter = new EventEmitter();
  const sent: DeployServerMessage[] = [];
  const ws = {
    readyState: 1,
    OPEN: 1,
    send: (data: string) => sent.push(JSON.parse(data)),
    on: (event: string, cb: (...args: unknown[]) => void) => emitter.on(event, cb),
  };
  return { ws: ws as unknown as import("ws").WebSocket, sent, close: () => emitter.emit("close") };
}

test("a fresh project with no run yet gets not_running", () => {
  const { ws, sent } = fakeSocket();
  handleDeployConnection(ws, "proj-fresh");
  assert.deepEqual(sent, [{ type: "not_running" }]);
});

test("connecting while a run is genuinely in progress replays its backlog", () => {
  startDeployRun("proj-live");
  recordDeployLine("proj-live", { type: "line", stream: "out", text: "step-1" });

  const { ws, sent } = fakeSocket();
  handleDeployConnection(ws, "proj-live");

  assert.deepEqual(sent, [{ type: "line", stream: "out", text: "step-1" }]);
});

test("regression: connecting after a PREVIOUS run finished must not replay its stale transcript", () => {
  // Simulates exactly the bug found during manual verification: an earlier
  // deploy already completed, then the user deploys again — the new
  // connection must not see the old run's lines mixed in before the new
  // ones arrive.
  startDeployRun("proj-repeat");
  recordDeployLine("proj-repeat", { type: "line", stream: "out", text: "old-run-step-1" });
  endDeployRun("proj-repeat", { type: "exit", success: true, exitCode: 0 });

  const { ws, sent } = fakeSocket();
  handleDeployConnection(ws, "proj-repeat");

  // Only "not_running" — never the previous run's "old-run-step-1" line.
  assert.deepEqual(sent, [{ type: "not_running" }]);
});

test("live lines recorded after connecting still arrive over the subscription", () => {
  // startDeployRun already happened (running:true, no lines yet) before
  // this connects, so no "not_running" — just the live lines as they come.
  startDeployRun("proj-subscribe");
  const { ws, sent } = fakeSocket();
  handleDeployConnection(ws, "proj-subscribe");

  recordDeployLine("proj-subscribe", { type: "line", stream: "out", text: "hello" });
  endDeployRun("proj-subscribe", { type: "exit", success: true, exitCode: 0 });

  assert.deepEqual(sent, [
    { type: "line", stream: "out", text: "hello" },
    { type: "exit", success: true, exitCode: 0 },
  ]);
});

test("unsubscribes on close, so later messages aren't delivered", () => {
  startDeployRun("proj-close");
  const { ws, sent, close } = fakeSocket();
  handleDeployConnection(ws, "proj-close");
  close();

  recordDeployLine("proj-close", { type: "line", stream: "out", text: "after close" });
  assert.deepEqual(sent, []);
});
