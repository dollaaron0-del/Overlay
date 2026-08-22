import { test } from "node:test";
import assert from "node:assert/strict";
import { parseUpdateUnitStatus, describeUpdateFailure, explainUpdateFailure } from "./update-status.js";

// Verbatim `systemctl show overlay-update.service -p …` output, including the
// real failure this was written for: the update aborting in git merge --ff-only
// because the checkout had uncommitted local changes.
const FAILED = `ActiveState=failed
Result=exit-code
ExecMainStatus=1
InvocationID=56491f97d77643fdb7d9ba84eed244ec`;

const RUNNING = `ActiveState=activating
Result=success
ExecMainStatus=0
InvocationID=aaaa1111bbbb2222cccc3333dddd4444`;

const NEVER_RUN = `ActiveState=inactive
Result=success
ExecMainStatus=0
InvocationID=`;

const SUCCEEDED = `ActiveState=inactive
Result=success
ExecMainStatus=0
InvocationID=99998888777766665555444433332222`;

test("a failed run is reported as failed, with its exit code and invocation", () => {
  const status = parseUpdateUnitStatus(FAILED);
  assert.equal(status.state, "failed");
  assert.equal(status.exitCode, 1);
  assert.equal(status.result, "exit-code");
  assert.equal(status.invocationId, "56491f97d77643fdb7d9ba84eed244ec");
});

test("a oneshot unit mid-run reads as running", () => {
  assert.equal(parseUpdateUnitStatus(RUNNING).state, "running");
  assert.equal(parseUpdateUnitStatus("ActiveState=deactivating").state, "running");
  assert.equal(parseUpdateUnitStatus("ActiveState=active").state, "running");
});

test("a finished or never-started run reads as idle", () => {
  assert.equal(parseUpdateUnitStatus(SUCCEEDED).state, "idle");
  assert.equal(parseUpdateUnitStatus(NEVER_RUN).state, "idle");
});

test("an empty InvocationID becomes null instead of an empty string", () => {
  assert.equal(parseUpdateUnitStatus(NEVER_RUN).invocationId, null);
  assert.equal(parseUpdateUnitStatus(SUCCEEDED).invocationId, "99998888777766665555444433332222");
});

test("the invocation id separates this run's failure from an old one", () => {
  // What the client compares: a stale failure carries the same id it had
  // before the trigger, a fresh one does not.
  const before = parseUpdateUnitStatus(FAILED);
  const stale = parseUpdateUnitStatus(FAILED);
  const fresh = parseUpdateUnitStatus(FAILED.replace("56491f97d77643fdb7d9ba84eed244ec", "0000ffff0000ffff"));
  assert.equal(stale.invocationId, before.invocationId);
  assert.notEqual(fresh.invocationId, before.invocationId);
});

test("unparseable or empty output degrades to idle rather than inventing a failure", () => {
  const status = parseUpdateUnitStatus("");
  assert.equal(status.state, "idle");
  assert.equal(status.exitCode, null);
  assert.equal(status.invocationId, null);
  assert.equal(status.result, null);
});

test("junk lines without a separator are skipped", () => {
  const status = parseUpdateUnitStatus(`Failed to get properties\nActiveState=failed\nExecMainStatus=2`);
  assert.equal(status.state, "failed");
  assert.equal(status.exitCode, 2);
});

test("values containing '=' survive parsing", () => {
  const status = parseUpdateUnitStatus("ActiveState=failed\nResult=exit-code\nExecMainStatus=1\nInvocationID=a=b");
  assert.equal(status.invocationId, "a=b");
});

test("without a journal the failure message names the exit code and the usual cause", () => {
  const message = describeUpdateFailure(parseUpdateUnitStatus(FAILED));
  assert.match(message, /Exit 1/);
  assert.match(message, /--ff-only/);
  assert.match(message, /journalctl -u overlay-update\.service/);
});

// Verbatim journal of the run that failed on 2026-08-22 — the case the guessed
// message was right about but could never name.
const BLOCKED_BY_LOCAL_CHANGES = `==> 1/7 Hole geprüften Branch (nur was bereits per PR reviewt+gemerged wurde)
error: Your local changes to the following files would be overwritten by merge:
\tserver/src/pty/pty.session.ts
Please commit your changes or stash them before you merge.
Aborting
Updating c7efd87..91a3cc7`;

test("the blocking file is named, with a command that unblocks it", () => {
  const message = describeUpdateFailure(parseUpdateUnitStatus(FAILED), BLOCKED_BY_LOCAL_CHANGES);
  assert.match(message, /server\/src\/pty\/pty\.session\.ts/);
  assert.match(message, /git -C \/opt\/overlay/);
  // The guess is gone once the real reason is known.
  assert.doesNotMatch(message, /Häufigste Ursache/);
});

test("more than three blocked files are summarised instead of listed in full", () => {
  const many = `error: Your local changes to the following files would be overwritten by merge:
\ta.ts
\tb.ts
\tc.ts
\td.ts
\te.ts
Please commit your changes or stash them before you merge.`;
  const message = explainUpdateFailure(many) ?? "";
  assert.match(message, /a\.ts, b\.ts, c\.ts und 2 weitere/);
  assert.doesNotMatch(message, /e\.ts/);
});

test("untracked files in the way get their own message", () => {
  const message = explainUpdateFailure(`error: The following untracked working tree files would be overwritten by merge:
\tweb/src/os/IconPicker.tsx
Please move or remove them before you merge.`);
  assert.match(message ?? "", /IconPicker\.tsx/);
  assert.match(message ?? "", /eigene Dateien/);
});

test("local commits on the checkout are reported as such, not as local changes", () => {
  const message = explainUpdateFailure("fatal: Not possible to fast-forward, aborting.") ?? "";
  assert.match(message, /eigene Commits/);
  assert.match(message, /@\{u\}\.\.HEAD/);
});

test("an unreachable GitHub says the checkout is untouched", () => {
  const message = explainUpdateFailure("fatal: unable to access 'https://github.com/…': Could not resolve host") ?? "";
  assert.match(message, /nicht erreichbar/);
  assert.match(message, /unverändert/);
});

test("a build failure names the step and the first compiler error", () => {
  const message =
    explainUpdateFailure(`==> 2/7 Installiere Abhängigkeiten (falls der Branch package-lock.json geändert hat)
==> 3/7 Baue neu
src/emmy/EmmyMath.tsx(7,41): error TS2307: Cannot find module 'katex' or its corresponding type declarations.
npm ERR! Lifecycle script \`build\` failed with error:`) ?? "";
  assert.match(message, /3\/7 Baue neu/);
  assert.match(message, /TS2307/);
});

test("progress output without an error still points at the step, not at a made-up cause", () => {
  const message = explainUpdateFailure("==> 4/7 Starte Overlay neu\n[PM2] [overlay](0) ✓") ?? "";
  assert.match(message, /4\/7 Starte Overlay neu/);
  assert.doesNotMatch(message, /Änderungen|Commits|erreichbar/);
});

test("an empty journal falls back to the generic hint instead of an empty message", () => {
  assert.equal(explainUpdateFailure(""), null);
  assert.match(describeUpdateFailure(parseUpdateUnitStatus(FAILED), ""), /Häufigste Ursache/);
});

test("a timeout keeps its own message even when a journal is available", () => {
  const status = parseUpdateUnitStatus("ActiveState=failed\nResult=timeout\nExecMainStatus=0");
  assert.match(describeUpdateFailure(status, BLOCKED_BY_LOCAL_CHANGES), /Timeout/);
});

test("a timeout gets its own message instead of the git one", () => {
  const message = describeUpdateFailure(parseUpdateUnitStatus("ActiveState=failed\nResult=timeout\nExecMainStatus=0"));
  assert.match(message, /Timeout/);
  assert.doesNotMatch(message, /--ff-only/);
});

test("a failure without a usable exit code omits the exit part", () => {
  const message = describeUpdateFailure(parseUpdateUnitStatus("ActiveState=failed\nResult=exit-code"));
  assert.doesNotMatch(message, /Exit/);
});
