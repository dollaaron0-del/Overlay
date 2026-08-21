import { listProjects, resolveProjectDir } from "./projects.registry.js";
import { getGitVersion } from "./git-version.js";
import { isDeployRunning } from "./deploy-log-bus.js";
import { runProjectDeploy } from "./deploy-service.js";

const POLL_INTERVAL_MS = 5000;
const ACTOR = "auto-deploy";

// Ties "changes made in a project's Terminal" to "what its Dashboard link
// shows" without the user having to remember a separate manual Deploy click
// — opt-in per project via autoDeployOnCommit (PATCH /:id), off by default
// so no existing project's behavior changes silently.
//
// Keyed by project id, not commit hash alone, so two different projects that
// happen to briefly share a hash (e.g. two empty scaffolds) never cross-wire.
const lastSeenCommit = new Map<string, string>();

let interval: NodeJS.Timeout | null = null;

async function tick(): Promise<void> {
  const projects = await listProjects().catch((err) => {
    console.error("[git-deploy-watcher] Failed to list projects:", err);
    return [];
  });

  const liveIds = new Set(projects.map((p) => p.id));
  for (const id of lastSeenCommit.keys()) {
    if (!liveIds.has(id)) lastSeenCommit.delete(id);
  }

  for (const project of projects) {
    if (!project.deployScript || !project.autoDeployOnCommit) continue;

    const version = await getGitVersion(resolveProjectDir(project)).catch(() => null);
    if (!version) continue;

    const previous = lastSeenCommit.get(project.id);
    lastSeenCommit.set(project.id, version.commit);

    // First sighting of this project (server just started, or auto-deploy
    // was just turned on) — record the baseline without deploying, so
    // restarting Overlay itself (or flipping the toggle on) never
    // retroactively deploys every already-up-to-date project.
    if (previous === undefined || previous === version.commit) continue;

    if (isDeployRunning(project.id)) {
      // A deploy (manual or a previous auto-trigger) is already in flight —
      // leave lastSeenCommit updated above so this doesn't get lost: if
      // that run finishes before the next tick, the *next* new commit still
      // triggers normally, and if more commits land in the meantime they're
      // covered by the same already-running deploy's git pull.
      continue;
    }

    console.log(`[git-deploy-watcher] New commit for "${project.id}" (${previous} -> ${version.commit}), auto-deploying`);
    await runProjectDeploy(project, ACTOR).catch((err) => {
      console.error(`[git-deploy-watcher] Auto-deploy failed for "${project.id}":`, err);
    });
  }
}

export function startGitDeployWatcher(): void {
  if (interval) return;
  interval = setInterval(() => void tick(), POLL_INTERVAL_MS);
}

export function stopGitDeployWatcher(): void {
  if (interval) clearInterval(interval);
  interval = null;
}
