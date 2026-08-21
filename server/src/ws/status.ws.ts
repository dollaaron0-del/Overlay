import type { WebSocket } from "ws";
import type { ProjectSummary, StatusServerMessage } from "@overlay/shared";
import { listProjects, resolveHomeSection, resolveProjectDir } from "../projects/projects.registry.js";
import { describeProcess, statusOf } from "../pm2/pm2.service.js";
import { systemdStatus } from "../systemd/systemd.service.js";
import { pm2RootStatus } from "../pm2root/pm2root.service.js";
import { getGitVersion } from "../projects/git-version.js";

const POLL_INTERVAL_MS = 3000;

// One project's status check throwing (e.g. an unexpected error from the
// systemd/pm2-root shell-out, beyond the "command failed" cases those
// already turn into "unknown") must never take down every other project's
// tile with it — every connected client would otherwise see an empty
// homescreen until the next successful tick. So each project is built
// independently and a failure here only degrades that one tile to
// "unknown" instead of rejecting the whole batch.
async function buildSummary(p: Awaited<ReturnType<typeof listProjects>>[number]): Promise<ProjectSummary> {
  // A systemd project's dirName is just an empty placeholder Overlay
  // created (see ensureStubDir in projects.registry.ts) — getGitVersion
  // harmlessly resolves to null for it (not a git repo), same as any
  // other non-git project directory.
  const version = await getGitVersion(resolveProjectDir(p)).catch(() => null);
  const homeSection = resolveHomeSection(p);

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
      autoDeployOnCommit: false,
      icon: p.icon,
      name: p.name,
      version,
      homeSection,
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
      autoDeployOnCommit: false,
      icon: p.icon,
      name: p.name,
      version,
      homeSection,
    } satisfies ProjectSummary;
  }

  const desc = await describeProcess(p.pm2Name!).catch(() => undefined);
  const env = desc?.pm2_env as { pm_uptime?: number; restart_time?: number } | undefined;
  const monit = desc?.monit as { memory?: number; cpu?: number } | undefined;
  return {
    id: p.id,
    dirName: p.dirName,
    pm2Name: p.pm2Name,
    externalUrl: p.externalUrl,
    status: statusOf(desc),
    uptimeMs: env?.pm_uptime ? Date.now() - env.pm_uptime : null,
    restarts: env?.restart_time ?? null,
    memoryBytes: monit?.memory ?? null,
    cpuPercent: monit?.cpu ?? null,
    hasDeployScript: Boolean(p.deployScript),
    autoDeployOnCommit: Boolean(p.autoDeployOnCommit),
    icon: p.icon,
    name: p.name,
    version,
    homeSection,
  } satisfies ProjectSummary;
}

async function buildSummaries(): Promise<ProjectSummary[]> {
  const projects = await listProjects();
  return Promise.all(
    projects.map(async (p) => {
      try {
        return await buildSummary(p);
      } catch (err) {
        console.error(`[status.ws] Failed to build status summary for project "${p.id}":`, err);
        return {
          id: p.id,
          dirName: p.dirName,
          kind: p.kind,
          pm2Name: p.pm2Name,
          externalUrl: p.externalUrl,
          status: "unknown",
          uptimeMs: null,
          restarts: null,
          memoryBytes: null,
          cpuPercent: null,
          hasDeployScript: false,
          autoDeployOnCommit: false,
          icon: p.icon,
          name: p.name,
          version: null,
          homeSection: resolveHomeSection(p),
        } satisfies ProjectSummary;
      }
    }),
  );
}

const activeSockets = new Set<WebSocket>();

// Lets project-mutation routes (e.g. POST /api/projects/scaffold) push an
// updated project list immediately instead of every connected client having
// to wait out the rest of its current 3s poll interval — otherwise a client
// that navigates straight to a just-created project right after the POST
// resolves can hit "Projekt nicht gefunden" before its next scheduled tick.
export function notifyProjectsChanged(): void {
  for (const ws of activeSockets) void tick(ws);
}

async function tick(ws: WebSocket): Promise<void> {
  if (ws.readyState !== ws.OPEN) return;
  const projects = await buildSummaries().catch((err) => {
    console.error("[status.ws] Failed to list projects:", err);
    return [];
  });
  ws.send(JSON.stringify({ type: "projects", projects } satisfies StatusServerMessage));
}

export function handleStatusConnection(ws: WebSocket): void {
  activeSockets.add(ws);
  void tick(ws);
  const interval = setInterval(() => void tick(ws), POLL_INTERVAL_MS);

  ws.on("close", () => {
    activeSockets.delete(ws);
    clearInterval(interval);
  });
}
