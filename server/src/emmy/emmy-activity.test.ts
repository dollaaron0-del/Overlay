import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { markWorking, markIdle, listActivities, getActivity, resetActivityForTests, DEFAULT_NOTE } from "./emmy-activity.js";
import { subscribeToEmmyActivity } from "./emmy-bus.js";
import type { EmmyActivity } from "@overlay/shared";

let published: EmmyActivity[][] = [];
let unsubscribe: () => void;

beforeEach(() => {
  resetActivityForTests();
  published = [];
  unsubscribe = subscribeToEmmyActivity((activities) => published.push(activities));
});

afterEach(() => {
  unsubscribe();
  resetActivityForTests();
});

test("nothing is busy until a turn is dispatched", () => {
  assert.deepEqual(listActivities(), []);
  assert.equal(getActivity("chat-1"), undefined);
});

test("markWorking records a chat with a default note and broadcasts it", () => {
  const activity = markWorking("chat-1");
  assert.equal(activity.chatId, "chat-1");
  assert.equal(activity.note, DEFAULT_NOTE);
  assert.equal(getActivity("chat-1")?.note, DEFAULT_NOTE);
  assert.equal(published.length, 1);
  assert.equal(published[0][0].chatId, "chat-1");
});

test("a progress note replaces the default but keeps the start time", async () => {
  const first = markWorking("chat-1");
  await new Promise((r) => setTimeout(r, 5));
  const second = markWorking("chat-1", "  Lese die angehängte PDF  ");

  assert.equal(second.note, "Lese die angehängte PDF", "notes are trimmed");
  assert.equal(second.since, first.since, "one continuous piece of work, not a restart");
  assert.ok(second.updatedAt >= first.updatedAt);
});

test("an empty note falls back to the note already shown", () => {
  markWorking("chat-1", "Suche im Repo");
  assert.equal(markWorking("chat-1", "   ").note, "Suche im Repo");
});

test("markIdle clears the chat and broadcasts once", () => {
  markWorking("chat-1");
  published = [];
  markIdle("chat-1");
  assert.deepEqual(listActivities(), []);
  assert.equal(published.length, 1);

  markIdle("chat-1");
  assert.equal(published.length, 1, "clearing an idle chat broadcasts nothing");
});

test("chats stay isolated from each other", () => {
  markWorking("chat-1", "A");
  markWorking("chat-2", "B");
  markIdle("chat-1");
  const remaining = listActivities();
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].chatId, "chat-2");
  assert.equal(remaining[0].note, "B");
});
