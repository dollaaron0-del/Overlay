import { useProjectsStatus } from "./useProjectsStatus";
import { ProjectCard } from "./ProjectCard";
import { useAuth } from "../auth/AuthProvider";

export function Sidebar({
  selectedId,
  onSelect,
  onShowSecurity,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
  onShowSecurity: () => void;
}) {
  const projects = useProjectsStatus();
  const { logout } = useAuth();

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h2>Overlay</h2>
        <button className="logout-button" onClick={() => logout()}>
          Abmelden
        </button>
      </div>
      <button className="security-nav-button" onClick={onShowSecurity}>
        🛡 Sicherheit
      </button>
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
