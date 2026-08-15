import type { WebSocket } from "ws";
import type { ProjectSummary, StatusServerMessage } from "@overlay/shared";
import { listProjects, resolveProjectDir } from "../projects/projects.registry.js";
import { describeProcess, statusOf } from "../pm2/pm2.service.js";
import { systemdStatus } from "../systemd/systemd.service.js";
import { pm2RootStatus } from "../pm2root/pm2root.service.js";
import { getGitVersion } from "../projects/git-version.js";

const POLL_INTERVAL_MS = 3000;

async function buildSummaries(): Promise<ProjectSummary[]> {
  const projects = await listProjects();
  return Promise.all(
    projects.map(async (p) => {
      // A systemd project's dirName is just an empty placeholder Overlay
      // created (see ensureStubDir in projects.registry.ts) — getGitVersion
      // harmlessly resolves to null for it (not a git repo), same as any
      // other non-git project directory.
      const version = await getGitVersion(resolveProjectDir(p)).catch(() => null);

      if (p.kind === "systemd") {
        return {
          id: p.id,
          dirName: p.dirName,
          kind: "systemd",
          externalUrl: p.externalUrl,
          status: await systemdStatus(p.systemdUnit!),
          uptimeMs: null,
          restarts: null,
          memoryBytes: null,
          cpuPercent: null,
          hasDeployScript: false,
          icon: p.icon,
          name: p.name,
          version,
        } satisfies ProjectSummary;
      }

      if (p.kind === "pm2-root") {
        return {
          id: p.id,
          dirName: p.dirName,
          kind: "pm2-root",
          externalUrl: p.externalUrl,
          status: await pm2RootStatus(p.pm2RootName!),
          uptimeMs: null,
          restarts: null,
          memoryBytes: null,
          cpuPercent: null,
          hasDeployScript: false,
          icon: p.icon,
          name: p.name,
          version,
        } satisfies ProjectSummary;
      }

      const desc = await describeProcess(p.pm2Name!).catch(() => undefined);
      const env = desc?.pm2_env as { pm_uptime?: number; restart_time?: number } | undefined;
      const monit = desc?.monit as { memory?: number; cpu?: number } | undefined;
      return {
        id: p.id,
        dirName: p.dirName,
        pm2Name: p.pm2Name,
        status: statusOf(desc),
        uptimeMs: env?.pm_uptime ? Date.now() - env.pm_uptime : null,
        restarts: env?.restart_time ?? null,
        memoryBytes: monit?.memory ?? null,
        cpuPercent: monit?.cpu ?? null,
        hasDeployScript: Boolean(p.deployScript),
        icon: p.icon,
        name: p.name,
        version,
      } satisfies ProjectSummary;
    }),
  );
}

export function handleStatusConnection(ws: WebSocket): void {
  let stopped = false;
  const send = (msg: StatusServerMessage) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };

  const tick = async () => {
    if (stopped) return;
    const projects = await buildSummaries().catch(() => []);
    send({ type: "projects", projects });
  };

  void tick();
  const interval = setInterval(() => void tick(), POLL_INTERVAL_MS);

  ws.on("close", () => {
    stopped = true;
    clearInterval(interval);
  });
}
