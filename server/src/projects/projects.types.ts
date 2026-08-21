export interface Project {
  id: string;
  // Every project — including kind "systemd" — has a real dirName under
  // APPS_ROOT, even though a systemd project's is just an empty placeholder
  // Overlay creates itself. This keeps every existing dirName-based feature
  // (security scan, files/obsidian tabs, idea-chat, terminal) working
  // unchanged instead of needing a kind-check at each of their call
  // sites — they just see an empty directory for a systemd project.
  dirName: string;
  /** "systemd" = controlled via a pre-existing systemd unit (see server/src/systemd/) instead of PM2. "pm2-root" = controlled via a PM2 process that lives in a *different* Linux user's PM2 daemon (see server/src/pm2root/), reached through sudo instead of Overlay's own local PM2 connection. Undefined = "pm2", today's behavior. */
  kind?: "pm2" | "systemd" | "pm2-root";
  /** Required when kind is "pm2"/undefined. */
  pm2Name?: string;
  /** Required when kind is "pm2"/undefined. */
  startScript?: string;
  /** Required when kind is "systemd": the exact unit name Overlay controls. Must have a matching sudoers rule on the real server, see docs/DEPLOYMENT.md. */
  systemdUnit?: string;
  /** Required when kind is "pm2-root": the exact process name in root's own PM2 daemon (e.g. `pm2 list` shows it under `user: root`). Must have a matching sudoers rule on the real server, see docs/DEPLOYMENT.md. */
  pm2RootName?: string;
  /**
   * Required when kind is "systemd" or "pm2-root": the app isn't served
   * through Overlay, so its (only) tile links out to this URL instead (e.g.
   * behind the same Tailscale+Authelia Caddy layer as Overlay itself).
   *
   * Optional for a normal PM2 project: set via PATCH /:id to *additionally*
   * show a second, synthetic Dashboard-section tile that links straight to
   * this URL, alongside the project's own Terminal-section tile — for a
   * project Overlay runs (terminal/logs/start-stop) that also has its own
   * web UI worth a one-click link. See HomeScreen.tsx's dashboardLinkItems.
   */
  externalUrl?: string;
  /** Optional shell command run by POST /:id/deploy, e.g. "git pull && npm install && npm run build". Not applicable to kind "systemd". */
  deployScript?: string;
  /**
   * When true, git-deploy-watcher.ts automatically runs this project's
   * deployScript (and restarts it on success) whenever a new commit appears
   * in its directory — e.g. one made in its own Terminal tab — instead of
   * requiring a manual "Deploy" click. Set via PATCH /:id; only meaningful
   * when deployScript is set. Undefined/false = manual deploy only (today's
   * default, unchanged for every existing project).
   */
  autoDeployOnCommit?: boolean;
  /** Optional custom home-screen icon (a single emoji), set via PATCH /:id. Falls back to a generic folder icon. */
  icon?: string;
  /** Optional custom display name, set via PATCH /:id. Falls back to dirName. */
  name?: string;
  /**
   * Manual override for which home-screen section this project's tile
   * appears in, set via PATCH /:id. Undefined = automatic: "dashboard" for
   * kind "systemd"/"pm2-root" (both link out to an externalUrl instead of
   * offering a terminal), "terminal" otherwise.
   */
  homeSection?: "dashboard" | "terminal";
}
