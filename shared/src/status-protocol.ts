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
}

export type StatusServerMessage = {
  type: "projects";
  projects: ProjectSummary[];
};
