import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// The store file path is computed at module-import time from process.cwd()
// (same pattern as ideachat-store.test.ts) — import dynamically, after
// chdir, not statically at the top of this file.
let tmpCwd: string;
let originalCwd: string;
let store: typeof import("./emmy-store.js");

before(async () => {
  originalCwd = process.cwd();
  tmpCwd = await fs.mkdtemp(path.join(os.tmpdir(), "overlay-emmy-store-test-"));
  process.chdir(tmpCwd);
  store = await import("./emmy-store.js");
});

after(async () => {
  process.chdir(originalCwd);
  await fs.rm(tmpCwd, { recursive: true, force: true });
});

test("listChats lazily creates and pins the general chat", async () => {
  const chats = await store.listChats();
  assert.equal(chats.length, 1);
  assert.equal(chats[0].id, store.GENERAL_CHAT_ID);
  assert.equal(chats[0].kind, "general");
  assert.equal(chats[0].status, "open");
});

test("the general chat starts empty", async () => {
  assert.deepEqual(await store.listMessages(store.GENERAL_CHAT_ID), []);
  assert.ok(await store.getChat(store.GENERAL_CHAT_ID));
});

test("createChat adds a task chat with its own id and defaults", async () => {
  const chat = await store.createChat("task", "  PDF zusammenfassen  ");
  assert.equal(chat.kind, "task");
  assert.equal(chat.title, "PDF zusammenfassen");
  assert.equal(chat.status, "open");
  assert.notEqual(chat.id, store.GENERAL_CHAT_ID);
  assert.ok(chat.id);

  assert.ok(await store.getChat(chat.id), "created chat should be retrievable");
});

test("createChat falls back to a default title when given blank input", async () => {
  const chat = await store.createChat("task", "   ");
  assert.equal(chat.title, "Neue Aufgabe");
});

test("appendMessage stores messages per chat and keeps them isolated", async () => {
  const chatA = await store.createChat("task", "A");
  const chatB = await store.createChat("task", "B");

  const a1 = await store.appendMessage(chatA.id, "me", "Frage A");
  await store.appendMessage(chatB.id, "me", "Frage B");
  const a2 = await store.appendMessage(chatA.id, "emmy", "Antwort A");

  const inA = await store.listMessages(chatA.id);
  assert.deepEqual(
    inA.map((m) => m.id),
    [a1.id, a2.id],
    "messages return in insertion order, scoped to their chat",
  );
  assert.ok(inA.every((m) => m.chatId === chatA.id));

  const inB = await store.listMessages(chatB.id);
  assert.equal(inB.length, 1);
  assert.equal(inB[0].text, "Frage B");
});

test("appendMessage bumps the chat's updatedAt so it can sort by activity", async () => {
  const chat = await store.createChat("task", "Aktivität");
  const before = (await store.getChat(chat.id))!.updatedAt;
  await new Promise((r) => setTimeout(r, 5));
  const message = await store.appendMessage(chat.id, "me", "ping");
  const after = (await store.getChat(chat.id))!.updatedAt;
  assert.equal(after, message.at);
  assert.ok(after >= before);
});

test("appendMessage persists attachments only when present", async () => {
  const chat = await store.createChat("task", "Anhang");
  const withAttachment = await store.appendMessage(chat.id, "me", "siehe Datei", [
    { filename: "1700000000-abc.pdf", originalName: "report.pdf", mimeType: "application/pdf", kind: "document" },
  ]);
  assert.equal(withAttachment.attachments?.length, 1);
  assert.equal(withAttachment.attachments?.[0].originalName, "report.pdf");

  const plain = await store.appendMessage(chat.id, "emmy", "keine Datei");
  assert.equal(plain.attachments, undefined);
});

test("appendMessage persists the reporting model only when given", async () => {
  const chat = await store.createChat("task", "Modell");
  const withModel = await store.appendMessage(
    chat.id,
    "emmy",
    "antwort",
    undefined,
    undefined,
    undefined,
    "claude-sonnet-5",
  );
  assert.equal(withModel.model, "claude-sonnet-5");

  const withoutModel = await store.appendMessage(chat.id, "emmy", "noch eine");
  assert.equal(withoutModel.model, undefined);
});

test("getLastAnsweredModel returns the newest emmy reply that carried a model", async () => {
  // Scans globally, newest-first across all chats.
  const chat = await store.createChat("task", "Neuestes Modell");
  await store.appendMessage(chat.id, "emmy", "gemini diesmal", undefined, undefined, undefined, "google/gemini-3.1-flash");
  assert.equal((await store.getLastAnsweredModel())?.model, "google/gemini-3.1-flash");

  // A later reply without a model does not clear the last known one.
  await store.appendMessage(chat.id, "emmy", "ohne modell");
  assert.equal((await store.getLastAnsweredModel())?.model, "google/gemini-3.1-flash");

  // A user message with a stray model-ish text is ignored (role gate).
  await store.appendMessage(chat.id, "me", "claude", undefined, undefined, undefined, "should-be-ignored");
  assert.equal((await store.getLastAnsweredModel())?.model, "google/gemini-3.1-flash");
});

test("updateChat patches title and status without touching other chats", async () => {
  const chat = await store.createChat("task", "Alt");
  const updated = await store.updateChat(chat.id, { title: "Neu", status: "done" });
  assert.equal(updated?.title, "Neu");
  assert.equal(updated?.status, "done");
  assert.equal(await store.updateChat("does-not-exist", { status: "done" }), undefined);
});

test("createChat stores the categorization it is given, and only for task chats", async () => {
  const task = await store.createChat("task", "Wochenbericht", {
    category: "research",
    categorySource: "auto",
    dueAt: "2026-08-17T21:59:59.000Z",
  });
  assert.equal(task.category, "research");
  assert.equal(task.categorySource, "auto");
  assert.equal(task.dueAt, "2026-08-17T21:59:59.000Z");
  assert.equal(task.intervalHours, undefined);

  const general = await store.createChat("general", "Zweitchat", { category: "research" });
  assert.equal(general.category, undefined, "a general chat is never a task and carries no category");
});

test("updateChat patches category fields without clearing the others", async () => {
  const chat = await store.createChat("task", "Preise prüfen", { category: "instant", categorySource: "auto" });
  const recurring = await store.updateChat(chat.id, {
    category: "recurring",
    categorySource: "manual",
    intervalHours: 12,
  });
  assert.equal(recurring?.category, "recurring");
  assert.equal(recurring?.categorySource, "manual");
  assert.equal(recurring?.intervalHours, 12);

  const renamed = await store.updateChat(chat.id, { title: "Preise" });
  assert.equal(renamed?.title, "Preise");
  assert.equal(renamed?.category, "recurring", "an unrelated patch leaves the category alone");
  assert.equal(renamed?.intervalHours, 12);
});

test("deleteChat removes the chat but keeps its messages in the archive", async () => {
  const chat = await store.createChat("task", "Wegwerf");
  const message = await store.appendMessage(chat.id, "me", "temporär");
  assert.equal(await store.deleteChat(chat.id), true);
  assert.equal(await store.getChat(chat.id), undefined);
  assert.deepEqual(await store.listMessages(chat.id), []);
  assert.equal(await store.deleteChat(chat.id), false);

  const archived = (await store.listArchive()).find((e) => e.chatId === chat.id);
  assert.ok(archived, "the deleted chat shows up in the archive");
  assert.equal(archived.title, "Wegwerf");
  assert.equal(archived.messageCount, 1);

  const entry = await store.getArchiveEntry(archived.id);
  assert.equal(entry?.messages[0].id, message.id);
  assert.equal(entry?.messages[0].text, "temporär");
  assert.deepEqual(await store.listArchivedMessages(chat.id), entry?.messages);
});

test("deleting the general chat empties it but keeps the chat itself", async () => {
  await store.appendMessage(store.GENERAL_CHAT_ID, "me", "Plauderei");
  await store.appendMessage(store.GENERAL_CHAT_ID, "emmy", "Antwort darauf");

  assert.equal(await store.deleteChat(store.GENERAL_CHAT_ID), true);
  const general = await store.getChat(store.GENERAL_CHAT_ID);
  assert.ok(general, "the general chat survives being cleared");
  assert.deepEqual(await store.listMessages(store.GENERAL_CHAT_ID), []);

  const archived = (await store.listArchive()).find((e) => e.chatId === store.GENERAL_CHAT_ID);
  assert.equal(archived?.messageCount, 2, "its history is archived, not thrown away");
});

test("clearing a chat with no messages archives nothing", async () => {
  const before = (await store.listArchive()).length;
  const chat = await store.createChat("task", "Nie benutzt");
  assert.equal(await store.deleteChat(chat.id), true);
  assert.equal((await store.listArchive()).length, before);
});

test("purgeArchiveEntry is the one call that really discards a conversation", async () => {
  const chat = await store.createChat("task", "Endgültig weg");
  await store.appendMessage(chat.id, "me", "geheim");
  await store.deleteChat(chat.id);
  const entry = (await store.listArchive()).find((e) => e.chatId === chat.id)!;

  assert.equal(await store.purgeArchiveEntry(entry.id), true);
  assert.equal(await store.getArchiveEntry(entry.id), undefined);
  assert.deepEqual(await store.listArchivedMessages(chat.id), []);
  assert.equal(await store.purgeArchiveEntry(entry.id), false);
});

test("survives a fresh module instance re-reading from disk", async () => {
  const chat = await store.createChat("task", "Persistenz");
  const message = await store.appendMessage(chat.id, "me", "Persistente Nachricht");

  const fresh = (await import(`./emmy-store.js?fresh=${Date.now()}`)) as typeof import("./emmy-store.js");
  const chats = await fresh.listChats();
  assert.ok(chats.some((c) => c.id === chat.id));
  const messages = await fresh.listMessages(chat.id);
  assert.ok(messages.some((m) => m.id === message.id && m.text === "Persistente Nachricht"));
});
