import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveHostShell } from "./host-terminal.manager.js";

// The bug this guards against: Overlay runs as a service user whose passwd
// shell is /usr/sbin/nologin (it must not be loginnable over ssh), so the
// $SHELL systemd hands the process refuses to start. Every host-terminal
// connection then opened, printed "This account is currently not
// available." and exited 1 — which from the browser looks exactly like the
// Server-Terminal being unreachable.
function withShellEnv(value: string | undefined, run: () => void): void {
  const previous = process.env.SHELL;
  if (value === undefined) delete process.env.SHELL;
  else process.env.SHELL = value;
  try {
    run();
  } finally {
    if (previous === undefined) delete process.env.SHELL;
    else process.env.SHELL = previous;
  }
}

test("a nologin $SHELL is skipped in favour of a real shell", () => {
  withShellEnv("/usr/sbin/nologin", () => {
    assert.equal(resolveHostShell(), "/bin/bash");
  });
});

test("/bin/false is skipped the same way", () => {
  withShellEnv("/bin/false", () => {
    assert.equal(resolveHostShell(), "/bin/bash");
  });
});

test("a $SHELL that does not exist is skipped instead of failing the spawn", () => {
  withShellEnv("/opt/definitely/not/a/shell", () => {
    assert.equal(resolveHostShell(), "/bin/bash");
  });
});

test("an unset $SHELL falls back to /bin/bash", () => {
  withShellEnv(undefined, () => {
    assert.equal(resolveHostShell(), "/bin/bash");
  });
});

test("a usable $SHELL is still preferred over the fallback", () => {
  withShellEnv("/bin/sh", () => {
    assert.equal(resolveHostShell(), "/bin/sh");
  });
});
