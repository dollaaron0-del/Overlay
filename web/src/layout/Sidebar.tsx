import { useState } from "react";
import type { ProjectSummary } from "@overlay/shared";
import { ProjectCard } from "./ProjectCard";
import { AddProjectForm } from "./AddProjectForm";
import { useAuth } from "../auth/AuthProvider";

export function Sidebar({
  projects,
  selectedId,
  onSelect,
  onShowSecurity,
  onShowOverview,
}: {
  projects: ProjectSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onShowSecurity: () => void;
  onShowOverview: () => void;
}) {
  const { logout } = useAuth();
  const [showAddForm, setShowAddForm] = useState(false);

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h2>Overlay</h2>
        <button className="logout-button" onClick={() => logout()}>
          Abmelden
        </button>
      </div>
      <button className="security-nav-button" onClick={onShowOverview}>
        🏠 Übersicht
      </button>
      <button className="security-nav-button" onClick={onShowSecurity}>
        🛡 Sicherheit
      </button>

      <div className="project-list-header">
        <span>Projekte</span>
        <button className="add-project-button" onClick={() => setShowAddForm(true)} title="Projekt hinzufügen">
          +
        </button>
      </div>

      {showAddForm && (
        <AddProjectForm onClose={() => setShowAddForm(false)} onAdded={() => setShowAddForm(false)} />
      )}

      <div className="project-list">
        {projects.length === 0 && <p className="empty-hint">Noch keine Projekte registriert.</p>}
        {projects.map((project) => (
          <ProjectCard
            key={project.id}
            project={project}
            selected={project.id === selectedId}
            onSelect={() => onSelect(project.id)}
          />
        ))}
      </div>
    </aside>
  );
}
