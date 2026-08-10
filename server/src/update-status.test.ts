import { test } from "node:test";
import assert from "node:assert/strict";
import { parseUpdateUnitStatus, describeUpdateFailure } from "./update-status.js";

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

test("the failure message names the exit code and the usual cause", () => {
  const message = describeUpdateFailure(parseUpdateUnitStatus(FAILED));
  assert.match(message, /Exit 1/);
  assert.match(message, /--ff-only/);
  assert.match(message, /journalctl -u overlay-update\.service/);
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
