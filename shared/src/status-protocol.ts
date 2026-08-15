// Message envelope for /ws/status (broadcast project/process status changes)

export type ProjectStatus = "online" | "stopped" | "errored" | "unknown";

export interface ProjectSummary {
  id: string;
  dirName: string;
  /** "systemd" = controlled via a pre-existing systemd unit instead of PM2. Undefined = "pm2", today's behavior. */
  kind?: "pm2" | "systemd";
  /** Present when kind is "pm2"/undefined. */
  pm2Name?: string;
  /** Present when kind is "systemd": the app isn't served through Overlay, its tile links out here instead. */
  externalUrl?: string;
  status: ProjectStatus;
  uptimeMs: number | null;
  restarts: number | null;
  memoryBytes: number | null;
  cpuPercent: number | null;
  hasDeployScript: boolean;
  /** Custom home-screen icon (single emoji), if the user set one. */
  icon?: string;
  /** Custom display name, if the user set one. Falls back to dirName. */
  name?: string;
  /** Current git commit/branch of the project directory, or null when it isn't a git repo. */
  version: { commit: string; branch: string | null } | null;
}

export type StatusServerMessage = {
  type: "projects";
  projects: ProjectSummary[];
};
