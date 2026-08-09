import { test } from "node:test";
import assert from "node:assert/strict";
import { PtySession } from "./pty.session.js";

// A pty is shared by every client attached to the same project, but has only
// one size. These cover the arbitration between them; the bug being pinned
// down is that a second, smaller client used to shrink the pty for everyone
// and it never grew back when that client left.
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

test("a second, smaller client shrinks the pty so output fits on both", () => {
  const session = newSession();
  try {
    session.setClientSize("desktop", 200, 50);
    session.setClientSize("ipad", 80, 24);
    assert.deepEqual(session.size, { cols: 80, rows: 24 });
  } finally {
    session.kill();
  }
});

test("a second, larger client does not stretch the pty past the smallest one", () => {
  const session = newSession();
  try {
    session.setClientSize("ipad", 80, 24);
    session.setClientSize("desktop", 200, 50);
    assert.deepEqual(session.size, { cols: 80, rows: 24 });
  } finally {
    session.kill();
  }
});

test("the smallest column count and row count are taken independently", () => {
  const session = newSession();
  try {
    session.setClientSize("wide-and-short", 200, 20);
    session.setClientSize("narrow-and-tall", 90, 60);
    assert.deepEqual(session.size, { cols: 90, rows: 20 });
  } finally {
    session.kill();
  }
});

test("disconnecting the smaller client gives the remaining one its size back", () => {
  const session = newSession();
  try {
    session.setClientSize("desktop", 200, 50);
    session.setClientSize("ipad", 80, 24);
    session.removeClient("ipad");
    assert.deepEqual(session.size, { cols: 200, rows: 50 }, "desktop must expand again once the iPad is gone");
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

test("a client reporting a new viewport replaces its previous one", () => {
  const session = newSession();
  try {
    session.setClientSize("desktop", 80, 24);
    session.setClientSize("desktop", 200, 50);
    assert.deepEqual(session.size, { cols: 200, rows: 50 }, "the old 80x24 must not keep constraining");
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
