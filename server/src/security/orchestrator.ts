import fs from "node:fs/promises";
import type { Finding, LlmTriage, ScanReport, ToolResult } from "@overlay/shared";
import { summarize } from "@overlay/shared";
import { config } from "../config.js";
import { listProjects, resolveProjectDir } from "../projects/projects.registry.js";
import { runCommand } from "./run-tool.js";
import { parseClamAvOutput } from "./parsers/clamav.js";
import { parseRkhunterOutput } from "./parsers/rkhunter.js";
import { parseChkrootkitOutput } from "./parsers/chkrootkit.js";
import { parseLynisReport } from "./parsers/lynis.js";
import { parseNpmAuditOutput } from "./parsers/npm-audit.js";
import { parseListeningPorts } from "./parsers/listening-ports.js";
import { parseAideOutput } from "./parsers/aide.js";
import { parseTrivyOutput } from "./parsers/trivy.js";
import { parseAptUpgradable } from "./parsers/apt-updates.js";
import { generateOllamaCompletion, OllamaUnavailableError } from "./ollama-client.js";
import { buildTriagePrompt } from "./triage-prompt.js";
import { makeReportId, saveReport } from "./report-store.js";

const RAW_OUTPUT_TRUNCATE_BYTES = 20_000;

async function runStage(
  tool: string,
  run: () => Promise<{ stdout: string }>,
  parse: (stdout: string) => Finding[],
): Promise<ToolResult> {
  const start = Date.now();
  try {
    const { stdout } = await run();
    const findings = parse(stdout);
    return {
      tool,
      status: findings.length > 0 ? "findings" : "ok",
      findings,
      raw: stdout.slice(0, RAW_OUTPUT_TRUNCATE_BYTES),
      durationMs: Date.now() - start,
    };
  } catch (err) {
    const isMissingTool = (err as NodeJS.ErrnoException).code === "ENOENT";
    return {
      tool,
      status: isMissingTool ? "skipped" : "error",
      findings: [],
      note: isMissingTool
        ? `Tool nicht installiert oder nicht im PATH (${(err as Error).message})`
        : (err as Error).message,
      durationMs: Date.now() - start,
    };
  }
}

async function runClamAvStage(): Promise<ToolResult> {
  return runStage(
    "clamav",
    async () => {
      // Best-effort signature update; freshclam can legitimately fail (rate
      // limits, no network yet) without that invalidating the scan itself.
      await runCommand("freshclam", [], { timeoutMs: 5 * 60_000 }).catch(() => undefined);
      return runCommand(
        "clamscan",
        ["-r", "-i", "--stdout", "--exclude-dir=^/(proc|sys|dev|run)", config.FULL_SYSTEM_SCAN_PATH],
        { timeoutMs: 6 * 60 * 60_000 },
      );
    },
    parseClamAvOutput,
  );
}

async function runRkhunterStage(): Promise<ToolResult> {
  return runStage(
    "rkhunter",
    () => runCommand("rkhunter", ["--check", "--skip-keypress", "--report-warnings-only"], { timeoutMs: 30 * 60_000 }),
    parseRkhunterOutput,
  );
}

async function runChkrootkitStage(): Promise<ToolResult> {
  return runStage("chkrootkit", () => runCommand("chkrootkit", [], { timeoutMs: 15 * 60_000 }), parseChkrootkitOutput);
}

async function runLynisStage(): Promise<ToolResult> {
  const start = Date.now();
  try {
    await runCommand("lynis", ["audit", "system", "--quiet", "--no-colors"], { timeoutMs: 30 * 60_000 });
    const reportDat = await fs.readFile(config.LYNIS_REPORT_PATH, "utf8");
    const findings = parseLynisReport(reportDat);
    return {
      tool: "lynis",
      status: findings.length > 0 ? "findings" : "ok",
      findings,
      raw: reportDat.slice(0, RAW_OUTPUT_TRUNCATE_BYTES),
      durationMs: Date.now() - start,
    };
  } catch (err) {
    const isMissingTool = (err as NodeJS.ErrnoException).code === "ENOENT";
    return {
      tool: "lynis",
      status: isMissingTool ? "skipped" : "error",
      findings: [],
      note: isMissingTool
        ? `Tool nicht installiert oder nicht im PATH (${(err as Error).message})`
        : (err as Error).message,
      durationMs: Date.now() - start,
    };
  }
}

async function runNpmAuditStage(): Promise<ToolResult> {
  const start = Date.now();
  const findings: Finding[] = [];
  const notes: string[] = [];

  const projects = await listProjects();
  for (const project of projects) {
    const projectDir = resolveProjectDir(project);
    const hasPackageJson = await fs
      .stat(`${projectDir}/package.json`)
      .then((s) => s.isFile())
      .catch(() => false);
    if (!hasPackageJson) continue;

    try {
      const { stdout } = await runCommand("npm", ["audit", "--json"], {
        cwd: projectDir,
        timeoutMs: 2 * 60_000,
      });
      findings.push(...parseNpmAuditOutput(stdout, project.dirName));
    } catch (err) {
      notes.push(`${project.dirName}: ${(err as Error).message}`);
    }
  }

  return {
    tool: "npm-audit",
    status: findings.length > 0 ? "findings" : "ok",
    findings,
    note: notes.length > 0 ? notes.join("; ") : undefined,
    durationMs: Date.now() - start,
  };
}

async function runAideStage(): Promise<ToolResult> {
  return runStage("aide", () => runCommand("aide", ["--check"], { timeoutMs: 60 * 60_000 }), parseAideOutput);
}

async function runTrivyStage(): Promise<ToolResult> {
  return runStage(
    "trivy",
    () =>
      runCommand("trivy", ["rootfs", "--format", "json", "--quiet", config.FULL_SYSTEM_SCAN_PATH], {
        timeoutMs: 60 * 60_000,
      }),
    parseTrivyOutput,
  );
}

async function runAptUpdatesStage(): Promise<ToolResult> {
  // Deliberately does NOT run `apt-get update` first: that hits the network
  // and can take a while, and standard Debian/Ubuntu installs already
  // refresh the package index daily via apt-daily.timer — this just reads
  // whatever index is already on disk, same information a `cron`-triggered
  // `apt-get update` would have prepared hours earlier.
  return runStage("apt-updates", () => runCommand("apt", ["list", "--upgradable"], { timeoutMs: 60_000 }), parseAptUpgradable);
}

async function runListeningPortsStage(): Promise<ToolResult> {
  const configuredHosts = config.SECURITY_SCAN_ALLOWED_HOSTS
    ? config.SECURITY_SCAN_ALLOWED_HOSTS.split(",")
        .map((h) => h.trim())
        .filter(Boolean)
    : [config.BIND_ADDRESS];

  return runStage(
    "listening-ports",
    () => runCommand("ss", ["-tulpn"], { timeoutMs: 30_000 }),
    (stdout) => parseListeningPorts(stdout, configuredHosts),
  );
}

/**
 * Advisory-only LLM triage over the findings the deterministic tools above
 * already produced. Deliberately runs LAST and deliberately never feeds back
 * into `tools` or the severity summary — see the LlmTriage doc comment in
 * shared/src/security-types.ts for why.
 */
export async function runLlmTriageStage(tools: ToolResult[]): Promise<LlmTriage> {
  const start = Date.now();

  if (!config.OLLAMA_MODEL) {
    return { status: "skipped", note: "OLLAMA_MODEL nicht konfiguriert", durationMs: Date.now() - start };
  }

  const totalFindings = tools.reduce((sum, t) => sum + t.findings.length, 0);
  if (totalFindings === 0) {
    return {
      status: "ok",
      model: config.OLLAMA_MODEL,
      text: "Keine Funde in dieser Nacht — keine Einschätzung nötig.",
      durationMs: Date.now() - start,
    };
  }

  try {
    const prompt = buildTriagePrompt(tools);
    const text = await generateOllamaCompletion(
      config.OLLAMA_BASE_URL,
      config.OLLAMA_MODEL,
      prompt,
      config.OLLAMA_TIMEOUT_MS,
    );
    return { status: "ok", model: config.OLLAMA_MODEL, text, durationMs: Date.now() - start };
  } catch (err) {
    const isUnavailable = err instanceof OllamaUnavailableError;
    return {
      status: isUnavailable ? "skipped" : "error",
      model: config.OLLAMA_MODEL,
      note: isUnavailable ? `Ollama nicht erreichbar: ${(err as Error).message}` : (err as Error).message,
      durationMs: Date.now() - start,
    };
  }
}

export async function runScan(): Promise<ScanReport> {
  const id = makeReportId();
  const startedAt = new Date().toISOString();
  const start = Date.now();

  const tools: ToolResult[] = [
    await runClamAvStage(),
    await runRkhunterStage(),
    await runChkrootkitStage(),
    await runLynisStage(),
    await runAideStage(),
    await runTrivyStage(),
    await runNpmAuditStage(),
    await runAptUpdatesStage(),
    await runListeningPortsStage(),
  ];

  const llmTriage = await runLlmTriageStage(tools);

  const finishedAt = new Date().toISOString();
  const report: ScanReport = {
    id,
    startedAt,
    finishedAt,
    durationSeconds: Math.round((Date.now() - start) / 1000),
    tools,
    summary: summarize(tools),
    llmTriage,
  };

  await saveReport(report);
  return report;
}
