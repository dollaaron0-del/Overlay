// Message envelope for /ws/status (broadcast project/process status changes)

export type ProjectStatus = "online" | "stopped" | "errored" | "unknown";

export interface ProjectSummary {
  id: string;
  dirName: string;
  pm2Name: string;
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
