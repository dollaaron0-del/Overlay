import type { WebSocket } from "ws";
import type { ProjectSummary, StatusServerMessage } from "@overlay/shared";
import { listProjects } from "../projects/projects.registry.js";
import { describeProcess, statusOf } from "../pm2/pm2.service.js";

const POLL_INTERVAL_MS = 3000;

async function buildSummaries(): Promise<ProjectSummary[]> {
  const projects = await listProjects();
  return Promise.all(
    projects.map(async (p) => {
      const desc = await describeProcess(p.pm2Name).catch(() => undefined);
      const env = desc?.pm2_env as { pm_uptime?: number; restart_time?: number } | undefined;
      const monit = desc?.monit as { memory?: number } | undefined;
      return {
        id: p.id,
        dirName: p.dirName,
        pm2Name: p.pm2Name,
        status: statusOf(desc),
        uptimeMs: env?.pm_uptime ? Date.now() - env.pm_uptime : null,
        restarts: env?.restart_time ?? null,
        memoryBytes: monit?.memory ?? null,
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
