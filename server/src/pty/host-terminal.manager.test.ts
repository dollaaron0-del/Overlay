import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../config.js";
import { resolveHostShell } from "./host-terminal.manager.js";

// The bug this guards against: Overlay runs as a service user whose passwd
// shell is /usr/sbin/nologin (it must not be loginnable over ssh), so the
// $SHELL systemd hands the process refuses to start. Every host-terminal
// connection then opened, printed "This account is currently not
// available." and exited 1 — which from the browser looks exactly like the
// Server-Terminal being unreachable.
//
// These cases exercise the $SHELL-fallback path, which only runs when
// HOST_TERMINAL_SHELL is unset — so the helper neutralises that env-derived
// config value too, otherwise the test result depends on the .env of
// whatever machine runs the suite (it is set on the production server).
function withShellEnv(value: string | undefined, run: () => void): void {
  const previousShell = process.env.SHELL;
  const previousOverride = config.HOST_TERMINAL_SHELL;
  if (value === undefined) delete process.env.SHELL;
  else process.env.SHELL = value;
  config.HOST_TERMINAL_SHELL = "";
  try {
    run();
  } finally {
    if (previousShell === undefined) delete process.env.SHELL;
    else process.env.SHELL = previousShell;
    config.HOST_TERMINAL_SHELL = previousOverride;
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
