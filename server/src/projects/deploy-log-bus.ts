import { EventEmitter } from "node:events";
import type { DeployServerMessage } from "@overlay/shared";

// In-process pub/sub keyed by project id, same pattern as pm2.logbus.ts —
// deploy runs in this same (unprivileged) process, so no cross-process
// bridge is needed here. Buffers each run's lines (cleared at the start of
// the next run) so a client that connects slightly after the deploy
// already started — or reconnects after it finished — still sees the full
// transcript, the same "backlog" idea pm2.logbus.ts uses for live logs.
const emitter = new EventEmitter();
emitter.setMaxListeners(0);

interface DeployRunState {
  running: boolean;
  lines: DeployServerMessage[];
}
const runs = new Map<string, DeployRunState>();

// A runaway/looping deploy script (e.g. a build step stuck retrying) must
// not buffer its output forever — cap the backlog the same way
// pm2.logbus.ts caps its live-log backlog.
const MAX_BACKLOG_LINES = 2000;

export function startDeployRun(projectId: string): void {
  runs.set(projectId, { running: true, lines: [] });
}

export function recordDeployLine(projectId: string, message: DeployServerMessage): void {
  const run = runs.get(projectId);
  if (run) {
    run.lines.push(message);
    if (run.lines.length > MAX_BACKLOG_LINES) run.lines.shift();
  }
  emitter.emit(projectId, message);
}

export function endDeployRun(projectId: string, exitMessage: DeployServerMessage): void {
  const run = runs.get(projectId);
  if (run) run.running = false;
  emitter.emit(projectId, exitMessage);
}

export function getDeployBacklog(projectId: string): { running: boolean; lines: DeployServerMessage[] } {
  const run = runs.get(projectId);
  return run ? { running: run.running, lines: run.lines } : { running: false, lines: [] };
}

/** True while a deploy for this project is in flight — used to reject a second concurrent deploy request instead of interleaving two runs' output and racing the trailing restart. */
export function isDeployRunning(projectId: string): boolean {
  return runs.get(projectId)?.running ?? false;
}

export function subscribeToDeployMessages(projectId: string, onMessage: (message: DeployServerMessage) => void): () => void {
  emitter.on(projectId, onMessage);
  return () => emitter.off(projectId, onMessage);
}
