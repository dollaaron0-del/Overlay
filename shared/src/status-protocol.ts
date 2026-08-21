// Message envelope for /ws/status (broadcast project/process status changes)

export type ProjectStatus = "online" | "stopped" | "errored" | "unknown";

export interface ProjectSummary {
  id: string;
  dirName: string;
  /** "systemd" = controlled via a pre-existing systemd unit instead of PM2. "pm2-root" = controlled via a PM2 process in a different Linux user's PM2 daemon, reached through sudo. Undefined = "pm2", today's behavior. */
  kind?: "pm2" | "systemd" | "pm2-root";
  /** Present when kind is "pm2"/undefined. */
  pm2Name?: string;
  /** Present when kind is "systemd" or "pm2-root": the app isn't served through Overlay, its tile links out here instead. */
  externalUrl?: string;
  status: ProjectStatus;
  uptimeMs: number | null;
  restarts: number | null;
  memoryBytes: number | null;
  cpuPercent: number | null;
  hasDeployScript: boolean;
  /** Whether git-deploy-watcher.ts should auto-run this project's deploy script whenever a new commit appears in its directory (e.g. one made in its own Terminal tab). Only meaningful when hasDeployScript is true. */
  autoDeployOnCommit: boolean;
  /** Custom home-screen icon (single emoji), if the user set one. */
  icon?: string;
  /** Custom display name, if the user set one. Falls back to dirName. */
  name?: string;
  /** Current git commit/branch of the project directory, or null when it isn't a git repo. */
  version: { commit: string; branch: string | null } | null;
  /**
   * Which home-screen section this project's tile appears in. Always
   * resolved server-side (never undefined here): falls back to "dashboard"
   * for kind "systemd"/"pm2-root" and "terminal" otherwise unless the user
   * set an explicit override via PATCH /:id.
   */
  homeSection: "dashboard" | "terminal";
}

export type StatusServerMessage = {
  type: "projects";
  projects: ProjectSummary[];
};
