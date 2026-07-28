import type { MouseEvent } from "react";
import type { ProjectSummary } from "@overlay/shared";
import { api } from "../api/client";

const STATUS_LABEL: Record<ProjectSummary["status"], string> = {
  online: "läuft",
  stopped: "gestoppt",
  errored: "Fehler",
  unknown: "unbekannt",
};

export function ProjectCard({
  project,
  selected,
  onSelect,
}: {
  project: ProjectSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  const runAction = async (action: "start" | "stop" | "restart", e: MouseEvent) => {
    e.stopPropagation();
    await api.post(`/api/projects/${project.id}/${action}`);
  };

  return (
    <div className={`project-card ${selected ? "selected" : ""}`} onClick={onSelect}>
      <div className="project-card-header">
        <span className={`status-dot status-${project.status}`} />
        <span className="project-name">{project.dirName}</span>
      </div>
      <div className="project-status-label">{STATUS_LABEL[project.status]}</div>
      <div className="project-actions">
        <button onClick={(e) => runAction("start", e)}>Start</button>
        <button onClick={(e) => runAction("stop", e)}>Stop</button>
        <button onClick={(e) => runAction("restart", e)}>Restart</button>
      </div>
    </div>
  );
}
