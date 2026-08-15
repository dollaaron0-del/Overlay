import { useEffect, useState } from "react";
import type { DeployServerMessage, ProjectSummary } from "@overlay/shared";
import { api } from "../api/client";
import { formatBytes } from "../format";
import { wsUrl } from "../api/ws";
import { TerminalPanel } from "../terminal/TerminalPanel";
import { LogPanel } from "../logs/LogPanel";
import { FileTree } from "../files/FileTree";
import { FileViewer } from "../files/FileViewer";
import { PlansTab } from "./PlansTab";
import { ObsidianTab } from "./ObsidianTab";
import { defaultProjectIcon } from "./project-icon";

type Tab = "terminal" | "logs" | "files" | "plans" | "obsidian";

const ICON_PRESETS = ["📁", "🚀", "💻", "🌐", "🔧", "📦", "🗂", "⚙️", "📊", "🔒", "🎨", "🛠", "📡", "🧩", "☁️", "🐳", "🔥", "📈"];

const STATUS_LABEL: Record<ProjectSummary["status"], string> = {
  online: "läuft",
  stopped: "gestoppt",
  errored: "Fehler",
  unknown: "unbekannt",
};

interface DeployResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export function ProjectWorkspace({ project, onRemoved }: { project: ProjectSummary; onRemoved: () => void }) {
  const isExternal = project.kind === "systemd" || project.kind === "pm2-root";
  const [tab, setTab] = useState<Tab>(isExternal ? "logs" : "terminal");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [deployResult, setDeployResult] = useState<DeployResult | null>(null);
  const [deployLines, setDeployLines] = useState<Array<{ stream: "out" | "err"; text: string }>>([]);
  const [deployStartedAt, setDeployStartedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);

  useEffect(() => {
    if (deployStartedAt === null) return;
    setElapsedSeconds(0);
    const interval = setInterval(() => setElapsedSeconds(Math.floor((Date.now() - deployStartedAt) / 1000)), 1000);
    return () => clearInterval(interval);
  }, [deployStartedAt]);

  const runAction = (action: "start" | "stop" | "restart") => api.post(`/api/projects/${project.id}/${action}`);

  const displayName = project.name || project.dirName;

  const setIcon = async (icon: string | null) => {
    await api.patch(`/api/projects/${project.id}`, { icon });
    setIconPickerOpen(false);
  };

  const renameProject = async () => {
    const next = window.prompt("Projekt umbenennen:", displayName);
    if (next === null) return;
    const trimmed = next.trim();
    if (!trimmed || trimmed === displayName) return;
    await api.patch(`/api/projects/${project.id}`, { name: trimmed });
  };

  const removeProject = async () => {
    if (!confirm(`"${displayName}" aus Overlay entfernen? Die Dateien und der Prozess bleiben erhalten.`)) {
      return;
    }
    await api.delete(`/api/projects/${project.id}`);
    onRemoved();
  };

  const deploy = async () => {
    setDeploying(true);
    setDeployResult(null);
    setDeployLines([]);
    setDeployStartedAt(Date.now());

    // Live output (see server/src/projects/deploy-runner.ts) — an arbitrary
    // deploy script has no known step count, so this real-time log + a
    // running timer is the honest stand-in for a progress bar here. Any
    // lines emitted before this connection finishes subscribing are still
    // delivered via the server-side backlog, so opening it doesn't need to
    // be awaited before triggering the deploy below.
    const ws = new WebSocket(wsUrl(`/ws/deploy/${project.id}`));
    ws.addEventListener("message", (event) => {
      try {
        const msg = JSON.parse(event.data) as DeployServerMessage;
        if (msg.type === "line") setDeployLines((prev) => [...prev, { stream: msg.stream, text: msg.text }]);
      } catch {
        // ignore malformed frames
      }
    });

    try {
      const result = await api.post<DeployResult>(`/api/projects/${project.id}/deploy`);
      setDeployResult(result);
    } finally {
      setDeploying(false);
      setDeployStartedAt(null);
      ws.close();
    }
  };

  return (
    <div className="project-workspace">
      <div className="project-workspace-header">
        <div className="project-workspace-title">
          <span className={`status-dot status-${project.status}`} />
          <button
            className="project-icon-button"
            onClick={() => setIconPickerOpen((v) => !v)}
            title="Icon ändern"
            aria-label="Icon ändern"
          >
            {project.icon || defaultProjectIcon(project.id)}
          </button>
          <span className="project-workspace-name">{displayName}</span>
          <button
            className="project-rename-button"
            onClick={renameProject}
            title="Projekt umbenennen"
            aria-label="Projekt umbenennen"
          >
            ✎
          </button>
          <span className="project-status-label">{STATUS_LABEL[project.status]}</span>
          {project.version && (
            <span
              className="project-version-badge"
              title={project.version.branch ? `Branch: ${project.version.branch}` : "Detached HEAD"}
            >
              {project.version.branch ? `${project.version.branch}@` : ""}
              {project.version.commit}
            </span>
          )}
        </div>
        {iconPickerOpen && (
          <div className="project-icon-picker">
            {ICON_PRESETS.map((icon) => (
              <button key={icon} onClick={() => setIcon(icon)} className="project-icon-picker-option">
                {icon}
              </button>
            ))}
            <button onClick={() => setIcon(null)} className="project-icon-picker-reset">
              Zurücksetzen
            </button>
          </div>
        )}
        {project.status === "online" && (project.cpuPercent !== null || project.memoryBytes !== null) && (
          <div className="project-resource-usage">
            {project.cpuPercent !== null && <span>{project.cpuPercent}% CPU</span>}
            {project.memoryBytes !== null && <span>{formatBytes(project.memoryBytes)} RAM</span>}
          </div>
        )}
        <div className="project-workspace-actions">
          <button onClick={() => runAction("start")}>Start</button>
          <button onClick={() => runAction("stop")}>Stop</button>
          <button onClick={() => runAction("restart")}>Restart</button>
          {project.hasDeployScript && (
            <button onClick={deploy} disabled={deploying}>
              {deploying ? "Deployt…" : "🚀 Deploy"}
            </button>
          )}
          {isExternal && project.externalUrl && (
            <a className="project-open-external-button" href={project.externalUrl} target="_blank" rel="noreferrer">
              Dashboard öffnen ↗
            </a>
          )}
          <button className="project-remove-button-inline" onClick={removeProject}>
            Entfernen
          </button>
        </div>
        {deploying && (
          <div className="project-deploy-live">
            <p className="project-deploy-live-timer">Deployt seit {elapsedSeconds}s…</p>
            <pre className="project-deploy-live-log">
              {deployLines.length === 0
                ? "Wartet auf Ausgabe…"
                : deployLines.map((l, i) => (
                    <span key={i} className={l.stream === "err" ? "deploy-result-stderr" : undefined}>
                      {l.text}
                      {"\n"}
                    </span>
                  ))}
            </pre>
          </div>
        )}
        {!deploying && deployResult && (
          <details className="project-deploy-result" open>
            <summary className={deployResult.ok ? "deploy-result-ok" : "deploy-result-error"}>
              {deployResult.ok ? "Deploy erfolgreich" : `Deploy fehlgeschlagen (exit ${deployResult.exitCode})`}
            </summary>
            {deployResult.stdout && <pre>{deployResult.stdout}</pre>}
            {deployResult.stderr && <pre className="deploy-result-stderr">{deployResult.stderr}</pre>}
          </details>
        )}
      </div>

      <nav className="tab-bar">
        {!isExternal && (
          <button className={tab === "terminal" ? "active" : ""} onClick={() => setTab("terminal")}>
            Terminal
          </button>
        )}
        <button className={tab === "logs" ? "active" : ""} onClick={() => setTab("logs")}>
          Logs
        </button>
        {!isExternal && (
          <>
            <button className={tab === "files" ? "active" : ""} onClick={() => setTab("files")}>
              Dateien
            </button>
            <button className={tab === "plans" ? "active" : ""} onClick={() => setTab("plans")}>
              Pläne
            </button>
            <button className={tab === "obsidian" ? "active" : ""} onClick={() => setTab("obsidian")}>
              Obsidian
            </button>
          </>
        )}
      </nav>
      <div className="tab-content">
        {!isExternal && tab === "terminal" && <TerminalPanel key={project.id} projectId={project.id} />}
        {tab === "logs" && <LogPanel key={project.id} projectId={project.id} />}
        {!isExternal && tab === "files" && (
          <div className="files-tab">
            <FileTree projectId={project.id} onSelectFile={setSelectedFile} />
            <FileViewer projectId={project.id} path={selectedFile} />
          </div>
        )}
        {!isExternal && tab === "plans" && <PlansTab key={project.id} projectId={project.id} />}
        {!isExternal && tab === "obsidian" && (
          <ObsidianTab key={project.id} projectId={project.id} projectDirName={project.dirName} />
        )}
      </div>
    </div>
  );
}
