import { test } from "node:test";
import assert from "node:assert/strict";
import { PtySession } from "./pty.session.js";

// A pty is shared by every client attached to the same project but has only
// one size, so the clients have to be arbitrated. The rule is "most recently
// active wins": clients re-report their viewport whenever they become visible,
// so the device actually being looked at decides, and a forgotten background
// tab stops constraining the one in use.
function newSession(): PtySession {
  return new PtySession("cat", [], process.cwd());
}

test("a single client's viewport becomes the pty size", () => {
  const session = newSession();
  try {
    session.setClientSize("desktop", 200, 50);
    assert.deepEqual(session.size, { cols: 200, rows: 50 });
  } finally {
    session.kill();
  }
});

test("the client that reported most recently wins, even if smaller", () => {
  const session = newSession();
  try {
    session.setClientSize("desktop", 200, 50);
    session.setClientSize("ipad", 80, 24);
    assert.deepEqual(session.size, { cols: 80, rows: 24 });
  } finally {
    session.kill();
  }
});

test("the client that reported most recently wins, even if larger", () => {
  const session = newSession();
  try {
    session.setClientSize("ipad", 80, 24);
    session.setClientSize("desktop", 200, 50);
    assert.deepEqual(session.size, { cols: 200, rows: 50 });
  } finally {
    session.kill();
  }
});

test("a background client never contributes just one dimension", () => {
  // The failure this pins down: taking the smallest of each dimension
  // separately gave the columns of a narrow portrait iPad and the rows of the
  // desktop, so output filled the full height but only part of the width.
  const session = newSession();
  try {
    session.setClientSize("ipad-portrait", 97, 64);
    session.setClientSize("desktop", 188, 48);
    assert.deepEqual(session.size, { cols: 188, rows: 48 }, "the active desktop must supply both dimensions");
  } finally {
    session.kill();
  }
});

test("re-reporting makes a client active again", () => {
  const session = newSession();
  try {
    session.setClientSize("desktop", 200, 50);
    session.setClientSize("ipad", 80, 24);
    session.setClientSize("desktop", 200, 50);
    assert.deepEqual(session.size, { cols: 200, rows: 50 }, "switching back to the desktop must restore its size");
  } finally {
    session.kill();
  }
});

test("disconnecting the active client falls back to the previous one", () => {
  const session = newSession();
  try {
    session.setClientSize("desktop", 200, 50);
    session.setClientSize("ipad", 80, 24);
    session.removeClient("ipad");
    assert.deepEqual(session.size, { cols: 200, rows: 50 }, "closing the iPad must give the desktop its size back");
  } finally {
    session.kill();
  }
});

test("the last client leaving keeps the size instead of collapsing it", () => {
  const session = newSession();
  try {
    session.setClientSize("desktop", 200, 50);
    session.removeClient("desktop");
    assert.deepEqual(session.size, { cols: 200, rows: 50 });
  } finally {
    session.kill();
  }
});

test("disconnecting an inactive client leaves the active one alone", () => {
  const session = newSession();
  try {
    session.setClientSize("ipad", 80, 24);
    session.setClientSize("desktop", 200, 50);
    session.removeClient("ipad");
    assert.deepEqual(session.size, { cols: 200, rows: 50 });
  } finally {
    session.kill();
  }
});

test("nonsensical viewports are ignored rather than resizing to zero", () => {
  const session = newSession();
  try {
    session.setClientSize("desktop", 120, 40);
    session.setClientSize("broken", 0, 0);
    session.setClientSize("also-broken", -5, 10);
    assert.deepEqual(session.size, { cols: 120, rows: 40 });
  } finally {
    session.kill();
  }
});

test("removing an unknown client changes nothing", () => {
  const session = newSession();
  try {
    session.setClientSize("desktop", 120, 40);
    session.removeClient("never-attached");
    assert.deepEqual(session.size, { cols: 120, rows: 40 });
  } finally {
    session.kill();
  }
});

// Spying on the underlying pty's write() (rather than reading back output)
// sidesteps the master side's own tty echo: `cat` doesn't reconfigure the
// pty out of cooked/echo mode, so the kernel driver echoes raw ESC bytes
// back in caret notation ("^[" instead of \x1B) before `cat` ever sees them
// — observing that would test the kernel's echo rendering, not what
// paste() actually wrote.
function spyOnWrite(session: PtySession): string[] {
  const writes: string[] = [];
  session.proc.write = (data: string) => writes.push(data);
  return writes;
}

test("paste() defaults to submitting: bracketed markers plus a trailing \\r", () => {
  const session = newSession();
  try {
    const writes = spyOnWrite(session);
    session.paste("hello");
    assert.deepEqual(writes, ["\x1b[200~hello\x1b[201~\r"]);
  } finally {
    session.kill();
  }
});

test("paste(text, false) omits the trailing \\r so the app doesn't auto-submit", () => {
  // This is the interactive terminal-panel path (Ctrl+V, right-click, the
  // paste box): a human should decide when to press Enter, not have it
  // pressed on their behalf the instant text lands.
  const session = newSession();
  try {
    const writes = spyOnWrite(session);
    session.paste("hello", false);
    assert.deepEqual(writes, ["\x1b[200~hello\x1b[201~"]);
  } finally {
    session.kill();
  }
});
