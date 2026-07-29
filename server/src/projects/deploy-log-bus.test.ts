import { test } from "node:test";
import assert from "node:assert/strict";
import {
  startDeployRun,
  recordDeployLine,
  endDeployRun,
  getDeployBacklog,
  subscribeToDeployMessages,
} from "./deploy-log-bus.js";

test("a project with no run yet reports not running, with an empty backlog", () => {
  assert.deepEqual(getDeployBacklog("proj-never-run"), { running: false, lines: [] });
});

test("startDeployRun marks a project running with an empty backlog", () => {
  startDeployRun("proj-a");
  assert.deepEqual(getDeployBacklog("proj-a"), { running: true, lines: [] });
});

test("recordDeployLine appends to the backlog and notifies live subscribers", () => {
  startDeployRun("proj-b");
  const received: unknown[] = [];
  const unsubscribe = subscribeToDeployMessages("proj-b", (msg) => received.push(msg));

  recordDeployLine("proj-b", { type: "line", stream: "out", text: "hello" });

  unsubscribe();
  assert.deepEqual(getDeployBacklog("proj-b"), {
    running: true,
    lines: [{ type: "line", stream: "out", text: "hello" }],
  });
  assert.deepEqual(received, [{ type: "line", stream: "out", text: "hello" }]);
});

test("endDeployRun marks the project as no longer running, keeping the backlog for a late subscriber", () => {
  startDeployRun("proj-c");
  recordDeployLine("proj-c", { type: "line", stream: "out", text: "building…" });
  endDeployRun("proj-c", { type: "exit", success: true, exitCode: 0 });

  assert.deepEqual(getDeployBacklog("proj-c"), {
    running: false,
    lines: [{ type: "line", stream: "out", text: "building…" }],
  });
});

test("starting a new run clears the previous run's backlog", () => {
  startDeployRun("proj-d");
  recordDeployLine("proj-d", { type: "line", stream: "out", text: "old run output" });
  endDeployRun("proj-d", { type: "exit", success: true, exitCode: 0 });

  startDeployRun("proj-d");
  assert.deepEqual(getDeployBacklog("proj-d"), { running: true, lines: [] });
});

test("subscribers only receive messages for their own project id", () => {
  startDeployRun("proj-e");
  startDeployRun("proj-f");
  const receivedE: unknown[] = [];
  const receivedF: unknown[] = [];
  const unsubE = subscribeToDeployMessages("proj-e", (msg) => receivedE.push(msg));
  const unsubF = subscribeToDeployMessages("proj-f", (msg) => receivedF.push(msg));

  recordDeployLine("proj-e", { type: "line", stream: "out", text: "hello" });

  unsubE();
  unsubF();
  assert.deepEqual(receivedE, [{ type: "line", stream: "out", text: "hello" }]);
  assert.deepEqual(receivedF, []);
});

test("a subscriber stops receiving messages after unsubscribing", () => {
  startDeployRun("proj-g");
  const received: unknown[] = [];
  const unsubscribe = subscribeToDeployMessages("proj-g", (msg) => received.push(msg));
  unsubscribe();

  recordDeployLine("proj-g", { type: "line", stream: "out", text: "should not arrive" });
  assert.deepEqual(received, []);
});
