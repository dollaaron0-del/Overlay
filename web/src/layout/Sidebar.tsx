import { useProjectsStatus } from "./useProjectsStatus";
import { ProjectCard } from "./ProjectCard";
import { useAuth } from "../auth/AuthProvider";

export function Sidebar({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
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
