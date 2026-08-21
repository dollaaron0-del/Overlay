import { config } from "../config.js";
import { appendAuditEntry } from "../audit/audit-log.js";
import { restartProcess } from "../pm2/pm2.service.js";
import { runDeployScript } from "./deploy-runner.js";
import { startDeployRun, recordDeployLine, endDeployRun } from "./deploy-log-bus.js";
import { resolveProjectDir } from "./projects.registry.js";
import type { Project } from "./projects.types.js";

export interface DeployOutcome {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

/**
 * Runs a project's deploy script end to end — streamed live to
 * /ws/deploy/:id (see deploy-log-bus.ts), restarting its PM2 process on
 * success, and recording an audit entry. Shared by the three places that
 * trigger a deploy: POST /api/projects/:id/deploy, the token-authenticated
 * automation route, and git-deploy-watcher.ts's auto-deploy-on-commit.
 *
 * Callers are responsible for checking project.deployScript is set and
 * isDeployRunning(project.id) is false first — this assumes both already
 * hold, so the two HTTP routes keep their own guards (for the right 400/409
 * status codes) and the watcher checks silently before calling in.
 */
export async function runProjectDeploy(project: Project, actor?: string): Promise<DeployOutcome> {
  startDeployRun(project.id);
  const result = await runDeployScript(project.deployScript!, resolveProjectDir(project), config.DEPLOY_TIMEOUT_MS, (line) => {
    recordDeployLine(project.id, { type: "line", stream: line.stream, text: line.text });
  }).catch((err) => ({ stdout: "", stderr: (err as Error).message, exitCode: null }));

  const success = result.exitCode === 0;
  endDeployRun(project.id, { type: "exit", success, exitCode: result.exitCode });

  if (success) {
    // deployScript (checked by every caller) is never set on a systemd- or
    // pm2-root-kind project, so pm2Name is guaranteed here even though the
    // type is optional.
    await restartProcess(project.pm2Name!).catch(() => undefined);
  }

  await appendAuditEntry({ type: "project_deployed", actor, detail: `${project.id} (${success ? "ok" : "failed"})` });
  return { success, stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
}
