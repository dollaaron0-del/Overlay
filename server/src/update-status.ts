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

/** Where the update unit runs — quoted in the recovery commands below. */
const CHECKOUT = "/opt/overlay";

/** The journal is only read for the failing run, so a few hundred lines suffice. */
export const UPDATE_JOURNAL_LINES = 200;

function fileList(lines: string[]): string {
  const shown = lines.slice(0, 3).join(", ");
  return lines.length > 3 ? `${shown} und ${lines.length - 3} weitere` : shown;
}

/**
 * The paths git lists under "would be overwritten by merge:" — one per line,
 * tab-indented, terminated by git's "Please commit …"/"Please move …" hint.
 */
function filesAfter(journal: string, marker: string): string[] {
  const start = journal.indexOf(marker);
  if (start < 0) return [];
  const files: string[] = [];
  for (const line of journal.slice(start + marker.length).split("\n").slice(1)) {
    if (!/^\s+\S/.test(line)) break;
    files.push(line.trim());
  }
  return files;
}

/** The `==> 3/7 Baue neu` banner the failing step printed, if it got that far. */
function lastStep(journal: string): string | null {
  let step: string | null = null;
  for (const line of journal.split("\n")) {
    const match = /^==>\s*(\d+\/\d+\s+.+?)\s*$/.exec(line);
    if (match) step = match[1];
  }
  return step;
}

/** First line that reads like the actual error, not like progress output. */
function firstErrorLine(journal: string): string | null {
  for (const line of journal.split("\n")) {
    const trimmed = line.trim();
    if (/^(error|fatal|npm error|npm ERR!)\b/i.test(trimmed) || /\berror TS\d+/.test(trimmed)) {
      return trimmed.slice(0, 200);
    }
  }
  return null;
}

/**
 * Turns the failing run's own output into the reason, instead of the guess the
 * UI used to show. The guess happened to be right the first time (a checkout
 * with local changes), which made it look more reliable than it was: it says
 * the same thing when npm ci fails, when the build breaks, or when the fetch
 * can't reach GitHub — and it never names the file that actually blocks the
 * merge, so every failure still meant an SSH session and a journalctl.
 *
 * Reading the journal for one invocation needs no privileges, so this stays on
 * the unprivileged read path next to `systemctl show`.
 */
export function explainUpdateFailure(journal: string): string | null {
  const blocked = filesAfter(journal, "Your local changes to the following files would be overwritten by merge:");
  if (blocked.length > 0) {
    return (
      `Update blockiert: der Checkout hat eigene, nicht committete Änderungen an ${fileList(blocked)}. ` +
      `Ansehen mit "sudo git -C ${CHECKOUT} diff", verwerfen mit "sudo git -C ${CHECKOUT} checkout -- ${blocked[0]}" ` +
      `oder aufheben mit "sudo git -C ${CHECKOUT} stash push" — danach erneut aktualisieren.`
    );
  }

  const untracked = filesAfter(journal, "The following untracked working tree files would be overwritten by merge:");
  if (untracked.length > 0) {
    return (
      `Update blockiert: im Checkout liegen eigene Dateien, die das Update überschreiben würde (${fileList(untracked)}). ` +
      `Auf dem Server wegräumen oder umbenennen, danach erneut aktualisieren.`
    );
  }

  if (/Not possible to fast-forward/i.test(journal)) {
    return (
      `Update blockiert: der Checkout hat eigene Commits, die nicht im geprüften Branch stehen — ` +
      `"git merge --ff-only" bricht deshalb ab. Prüfen mit "sudo git -C ${CHECKOUT} log --oneline @{u}..HEAD".`
    );
  }

  if (/(fatal: unable to access|Could not resolve host|Connection timed out)/i.test(journal)) {
    return `Update fehlgeschlagen: GitHub war nicht erreichbar, der Checkout ist unverändert. Später erneut versuchen.`;
  }

  const step = lastStep(journal);
  const error = firstErrorLine(journal);
  if (step && error) return `Update fehlgeschlagen bei Schritt ${step}: ${error}`;
  if (error) return `Update fehlgeschlagen: ${error}`;
  if (step) return `Update fehlgeschlagen bei Schritt ${step}. Details: journalctl -u overlay-update.service`;
  return null;
}

/**
 * German one-liner for a failed run — the UI shows this instead of a spinner.
 * `journal` is the failing run's own output when it could be read; without it
 * (no journal access, unit never ran) this falls back to the generic hint.
 */
export function describeUpdateFailure(status: UpdateUnitStatus, journal?: string): string {
  const exit = status.exitCode !== null && status.exitCode > 0 ? ` (Exit ${status.exitCode})` : "";
  if (status.result === "timeout") {
    return "Update abgebrochen: das Unit-Timeout ist abgelaufen. Details: journalctl -u overlay-update.service";
  }
  const explained = journal ? explainUpdateFailure(journal) : null;
  if (explained) return explained;
  return (
    `Update fehlgeschlagen${exit}. Häufigste Ursache: lokale Änderungen im Checkout, ` +
    `die "git merge --ff-only" blockieren. Details: journalctl -u overlay-update.service`
  );
}
