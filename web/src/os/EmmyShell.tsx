import { useState } from "react";
import { useProjectsStatus } from "../layout/useProjectsStatus";
import { TopBar } from "./TopBar";
import { ProjectWorkspace } from "./ProjectWorkspace";
import { EmmyChatApp } from "../emmy/EmmyChatApp";

/**
 * Root shell, post-redesign: Emmy's chat is the only home screen. The old
 * OS-style desktop (icon grid, Spotlight, Control Center, static apps) is
 * gone — project terminals stay reachable only because EmmyChatApp's "send
 * to project" flow needs somewhere to land.
 */
export function EmmyShell() {
  const projects = useProjectsStatus();
  const [openProjectId, setOpenProjectId] = useState<string | null>(null);

  const openProject = (projectId: string) => setOpenProjectId(projectId);
  const goHome = () => setOpenProjectId(null);

  if (openProjectId !== null) {
    const project = projects.find((p) => p.id === openProjectId);
    return (
      <div className="os-shell">
        <div className="os-shell-body">
          <TopBar title={project?.name || project?.dirName || "Projekt"} showBack onBack={goHome} />
          <main className="os-main">
            {project ? (
              <ProjectWorkspace project={project} onRemoved={goHome} />
            ) : (
              <div className="empty-hint main-empty">
                Projekt nicht gefunden. <button onClick={goHome}>Zurück</button>
              </div>
            )}
          </main>
        </div>
      </div>
    );
  }

  return <EmmyChatApp onOpenProject={openProject} />;
}
