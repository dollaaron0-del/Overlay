import { useState } from "react";
import type { MouseEvent } from "react";
import type { ProjectSummary } from "@overlay/shared";
import { api } from "../api/client";
import { formatBytes } from "../format";

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

export function ProjectCard({
  project,
  selected,
  onSelect,
}: {
  project: ProjectSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  const [deploying, setDeploying] = useState(false);
  const [deployResult, setDeployResult] = useState<DeployResult | null>(null);

  const runAction = async (action: "start" | "stop" | "restart", e: MouseEvent) => {
    e.stopPropagation();
    await api.post(`/api/projects/${project.id}/${action}`);
  };

  const removeProject = async (e: MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`"${project.dirName}" aus Overlay entfernen? Die Dateien und der Prozess bleiben erhalten.`)) {
      return;
    }
    await api.delete(`/api/projects/${project.id}`);
  };

  const deploy = async (e: MouseEvent) => {
    e.stopPropagation();
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
    <div className={`project-card ${selected ? "selected" : ""}`} onClick={onSelect}>
      <div className="project-card-header">
        <span className={`status-dot status-${project.status}`} />
        <span className="project-name">{project.dirName}</span>
        <button className="project-remove-button" title="Projekt entfernen" onClick={removeProject}>
          ✕
        </button>
      </div>
      <div className="project-status-label">{STATUS_LABEL[project.status]}</div>
      {project.status === "online" && (project.cpuPercent !== null || project.memoryBytes !== null) && (
        <div className="project-resource-usage">
          {project.cpuPercent !== null && <span>{project.cpuPercent}% CPU</span>}
          {project.memoryBytes !== null && <span>{formatBytes(project.memoryBytes)} RAM</span>}
        </div>
      )}
      <div className="project-actions">
        <button onClick={(e) => runAction("start", e)}>Start</button>
        <button onClick={(e) => runAction("stop", e)}>Stop</button>
        <button onClick={(e) => runAction("restart", e)}>Restart</button>
      </div>
      {project.hasDeployScript && (
        <div className="project-deploy" onClick={(e) => e.stopPropagation()}>
          <button className="project-deploy-button" onClick={deploy} disabled={deploying}>
            {deploying ? "Deployt…" : "🚀 Deploy"}
          </button>
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
      )}
    </div>
  );
}
