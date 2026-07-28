export type Severity = "critical" | "high" | "medium" | "low" | "info";

export interface Finding {
  severity: Severity;
  message: string;
  /** Which sub-check within a tool this came from, e.g. a file path or project id. */
  context?: string;
}

export type ToolStatus = "ok" | "findings" | "error" | "skipped";

export interface ToolResult {
  tool: string;
  status: ToolStatus;
  findings: Finding[];
  /** Truncated raw output, kept for a "Details" expand in the dashboard. */
  raw?: string;
  /** Set when status is "error" or "skipped" (e.g. the tool isn't installed). */
  note?: string;
  durationMs: number;
}

export interface SeverityCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

export type LlmTriageStatus = "ok" | "skipped" | "error";

/**
 * A supplementary, advisory-only narrative summary from a local LLM (see
 * security/ollama-client.ts) — deliberately NOT a Finding[] and deliberately
 * NOT consulted by summarize() below. It never changes severities or counts,
 * only adds a plain-language triage note on top of what the deterministic
 * tools already found. The dashboard must render it as clearly distinct from
 * (and secondary to) the real findings.
 */
export interface LlmTriage {
  status: LlmTriageStatus;
  model?: string;
  text?: string;
  note?: string;
  durationMs: number;
}

export interface ScanReport {
  id: string; // e.g. "2026-07-29T02-00-00"
  startedAt: string; // ISO timestamp
  finishedAt: string;
  durationSeconds: number;
  tools: ToolResult[];
  summary: SeverityCounts;
  llmTriage?: LlmTriage;
}

export function emptySeverityCounts(): SeverityCounts {
  return { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
}

export function summarize(tools: ToolResult[]): SeverityCounts {
  const counts = emptySeverityCounts();
  for (const tool of tools) {
    for (const finding of tool.findings) {
      counts[finding.severity]++;
    }
  }
  return counts;
}
