/**
 * Reads the result of the last "Jetzt aktualisieren" run off systemd.
 *
 * The trigger route can only report whether the unit was *queued*
 * (`systemctl start --no-block`, which it has to be — the unit's last step
 * restarts this very process). Nobody was asking systemd how that run then
 * went, so an update that failed in its first second looked exactly like one
 * still working: the UI polled /api/health for three minutes and then blamed
 * the restart for "taking longer than expected".
 *
 * `systemctl show` needs no privileges (unlike the sudo-gated `start`), so
 * this is a plain read.
 */

export type UpdateUnitState = "idle" | "running" | "failed";

export interface UpdateUnitStatus {
  state: UpdateUnitState;
  /** Exit code of the last run; 0 (or absent) when it never failed. */
  exitCode: number | null;
  /**
   * systemd's id for one specific run. It changes on every start, which is how
   * the client tells "the run I just triggered failed" apart from "a run failed
   * some time last week and nobody cleared it".
   */
  invocationId: string | null;
  /** systemd's own verdict: "success", "exit-code", "timeout", … */
  result: string | null;
}

function parseShowOutput(stdout: string): Record<string, string> {
  const properties: Record<string, string> = {};
  for (const line of stdout.split("\n")) {
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    properties[line.slice(0, separator)] = line.slice(separator + 1).trim();
  }
  return properties;
}

/** The properties to ask `systemctl show` for; kept next to the parser that reads them. */
export const UPDATE_UNIT_PROPERTIES = "ActiveState,Result,ExecMainStatus,InvocationID";

export function parseUpdateUnitStatus(stdout: string): UpdateUnitStatus {
  const properties = parseShowOutput(stdout);
  const activeState = properties.ActiveState ?? "";
  const exitCode = properties.ExecMainStatus ? Number(properties.ExecMainStatus) : null;

  // "activating" is a oneshot unit while ExecStart runs; "deactivating" is it
  // being torn down. "active" only shows up with RemainAfterExit, which this
  // unit doesn't set — treated as running anyway rather than as a silent idle.
  const state: UpdateUnitState =
    activeState === "failed"
      ? "failed"
      : activeState === "activating" || activeState === "active" || activeState === "deactivating"
        ? "running"
        : "idle";

  return {
    state,
    exitCode: Number.isFinite(exitCode) ? exitCode : null,
    invocationId: properties.InvocationID || null,
    result: properties.Result || null,
  };
}

/** German one-liner for a failed run — the UI shows this instead of a spinner. */
export function describeUpdateFailure(status: UpdateUnitStatus): string {
  const exit = status.exitCode !== null && status.exitCode > 0 ? ` (Exit ${status.exitCode})` : "";
  if (status.result === "timeout") {
    return "Update abgebrochen: das Unit-Timeout ist abgelaufen. Details: journalctl -u overlay-update.service";
  }
  return (
    `Update fehlgeschlagen${exit}. Häufigste Ursache: lokale Änderungen im Checkout, ` +
    `die "git merge --ff-only" blockieren. Details: journalctl -u overlay-update.service`
  );
}
