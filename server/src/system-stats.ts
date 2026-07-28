import os from "node:os";
import fs from "node:fs/promises";
import { config } from "./config.js";

export interface SystemStats {
  loadAvg1: number;
  loadAvg5: number;
  loadAvg15: number;
  cpuCount: number;
  totalMemBytes: number;
  freeMemBytes: number;
  diskTotalBytes: number | null;
  diskFreeBytes: number | null;
}

export async function getSystemStats(): Promise<SystemStats> {
  const [loadAvg1, loadAvg5, loadAvg15] = os.loadavg();
  let diskTotalBytes: number | null = null;
  let diskFreeBytes: number | null = null;
  try {
    const stat = await fs.statfs(config.APPS_ROOT);
    diskTotalBytes = stat.blocks * stat.bsize;
    diskFreeBytes = stat.bavail * stat.bsize;
  } catch {
    // statfs can fail if APPS_ROOT doesn't exist yet on a fresh install —
    // disk stats are a nice-to-have, not worth failing the whole endpoint.
  }
  return {
    loadAvg1,
    loadAvg5,
    loadAvg15,
    cpuCount: os.cpus().length,
    totalMemBytes: os.totalmem(),
    freeMemBytes: os.freemem(),
    diskTotalBytes,
    diskFreeBytes,
  };
}
