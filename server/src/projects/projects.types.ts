export interface Project {
  id: string;
  // Every project — including kind "systemd" — has a real dirName under
  // APPS_ROOT, even though a systemd project's is just an empty placeholder
  // Overlay creates itself. This keeps every existing dirName-based feature
  // (security scan, files/obsidian tabs, idea-chat, quick-capture, terminal)
  // working unchanged instead of needing a kind-check at each of their call
  // sites — they just see an empty directory for a systemd project.
  dirName: string;
  /** "systemd" = controlled via a pre-existing systemd unit (see server/src/systemd/) instead of PM2. Undefined = "pm2", today's behavior. */
  kind?: "pm2" | "systemd";
  /** Required when kind is "pm2"/undefined. */
  pm2Name?: string;
  /** Required when kind is "pm2"/undefined. */
  startScript?: string;
  /** Required when kind is "systemd": the exact unit name Overlay controls. Must have a matching sudoers rule on the real server, see docs/DEPLOYMENT.md. */
  systemdUnit?: string;
  /** Required when kind is "systemd": the app isn't served through Overlay, so its tile links out to this URL instead (e.g. behind the same Tailscale+Authelia Caddy layer as Overlay itself). */
  externalUrl?: string;
  /** Optional shell command run by POST /:id/deploy, e.g. "git pull && npm install && npm run build". Not applicable to kind "systemd". */
  deployScript?: string;
  /** Optional custom home-screen icon (a single emoji), set via PATCH /:id. Falls back to a generic folder icon. */
  icon?: string;
  /** Optional custom display name, set via PATCH /:id. Falls back to dirName. */
  name?: string;
}
