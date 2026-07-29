import { useState } from "react";
import type { ProjectSummary } from "@overlay/shared";
import { api } from "../api/client";
import { formatBytes } from "../format";
import { TerminalPanel } from "../terminal/TerminalPanel";
import { LogPanel } from "../logs/LogPanel";
import { FileTree } from "../files/FileTree";
import { FileViewer } from "../files/FileViewer";

type Tab = "terminal" | "logs" | "files";

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
  const [tab, setTab] = useState<Tab>("terminal");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [deployResult, setDeployResult] = useState<DeployResult | null>(null);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);

  const runAction = (action: "start" | "stop" | "restart") => api.post(`/api/projects/${project.id}/${action}`);

  const setIcon = async (icon: string | null) => {
    await api.patch(`/api/projects/${project.id}`, { icon });
    setIconPickerOpen(false);
  };

  const removeProject = async () => {
    if (!confirm(`"${project.dirName}" aus Overlay entfernen? Die Dateien und der Prozess bleiben erhalten.`)) {
      return;
    }
    await api.delete(`/api/projects/${project.id}`);
    onRemoved();
  };

  const deploy = async () => {
    setDeploying(true);
    setDeployResult(null);
    try {
      const result = await api.post<DeployResult>(`/api/projects/${project.id}/deploy`);
      setDeployResult(result);
    } finally {
      setDeploying(false);
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
            {project.icon || "📁"}
          </button>
          <span className="project-workspace-name">{project.dirName}</span>
          <span className="project-status-label">{STATUS_LABEL[project.status]}</span>
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
          <button className="project-remove-button-inline" onClick={removeProject}>
            Entfernen
          </button>
        </div>
        {deployResult && (
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
        <button className={tab === "terminal" ? "active" : ""} onClick={() => setTab("terminal")}>
          Terminal
        </button>
        <button className={tab === "logs" ? "active" : ""} onClick={() => setTab("logs")}>
          Logs
        </button>
        <button className={tab === "files" ? "active" : ""} onClick={() => setTab("files")}>
          Dateien
        </button>
      </nav>
      <div className="tab-content">
        {tab === "terminal" && <TerminalPanel key={project.id} projectId={project.id} />}
        {tab === "logs" && <LogPanel key={project.id} projectId={project.id} />}
        {tab === "files" && (
          <div className="files-tab">
            <FileTree projectId={project.id} onSelectFile={setSelectedFile} />
            <FileViewer projectId={project.id} path={selectedFile} />
          </div>
        )}
      </div>
    </div>
  );
}
