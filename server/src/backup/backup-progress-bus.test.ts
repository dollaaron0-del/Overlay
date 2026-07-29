import { test } from "node:test";
import assert from "node:assert/strict";
import { emitBackupProgress, subscribeToBackupProgress } from "./backup-progress-bus.js";

test("delivers emitted messages to a subscriber", () => {
  const received: unknown[] = [];
  const unsubscribe = subscribeToBackupProgress((msg) => received.push(msg));

  emitBackupProgress({ type: "progress", percentDone: 0.5, filesDone: 5, totalFiles: 10 });
  emitBackupProgress({ type: "done" });

  unsubscribe();
  assert.deepEqual(received, [
    { type: "progress", percentDone: 0.5, filesDone: 5, totalFiles: 10 },
    { type: "done" },
  ]);
});

test("a subscriber stops receiving messages after unsubscribing", () => {
  const received: unknown[] = [];
  const unsubscribe = subscribeToBackupProgress((msg) => received.push(msg));
  unsubscribe();

  emitBackupProgress({ type: "done" });
  assert.deepEqual(received, []);
});

test("multiple subscribers each receive every message", () => {
  const a: unknown[] = [];
  const b: unknown[] = [];
  const unsubA = subscribeToBackupProgress((msg) => a.push(msg));
  const unsubB = subscribeToBackupProgress((msg) => b.push(msg));

  emitBackupProgress({ type: "done" });

  unsubA();
  unsubB();
  assert.equal(a.length, 1);
  assert.equal(b.length, 1);
});
