import type { SeverityCounts } from "@overlay/shared";

export const SEVERITY_ORDER: (keyof SeverityCounts)[] = ["critical", "high", "medium", "low", "info"];

export const SEVERITY_LABEL: Record<keyof SeverityCounts, string> = {
  critical: "Kritisch",
  high: "Hoch",
  medium: "Mittel",
  low: "Niedrig",
  info: "Info",
};

export interface ScanSummary {
  id: string;
  startedAt: string;
  finishedAt: string;
  durationSeconds: number;
  summary: SeverityCounts;
}

export function isAllClear(summary: SeverityCounts): boolean {
  return SEVERITY_ORDER.every((sev) => summary[sev] === 0);
}
