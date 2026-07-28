import { useState } from "react";
import { Sidebar } from "./Sidebar";
import { Overview } from "./Overview";
import { useProjectsStatus } from "./useProjectsStatus";
import { TerminalPanel } from "../terminal/TerminalPanel";
import { LogPanel } from "../logs/LogPanel";
import { FileTree } from "../files/FileTree";
import { FileViewer } from "../files/FileViewer";
import { SecurityDashboard } from "../security/SecurityDashboard";
import { ActivityLog } from "../activity/ActivityLog";

type Tab = "terminal" | "logs" | "files";
type View = "overview" | "project" | "security" | "activity";

export function AppShell() {
  const projects = useProjectsStatus();
  const [view, setView] = useState<View>("overview");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("terminal");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const selectProject = (id: string) => {
    setSelectedId(id);
    setSelectedFile(null);
    setView("project");
  };

  return (
    <div className="app-shell">
      <Sidebar
        projects={projects}
        selectedId={selectedId}
        onSelect={selectProject}
        onShowSecurity={() => setView("security")}
        onShowOverview={() => setView("overview")}
        onShowActivity={() => setView("activity")}
      />
      <main className="main-panel">
        {view === "overview" && (
          <Overview projects={projects} onSelectProject={selectProject} onShowSecurity={() => setView("security")} />
        )}
        {view === "security" && <SecurityDashboard />}
        {view === "activity" && <ActivityLog />}
        {view === "project" &&
          (!selectedId ? (
            <div className="empty-hint main-empty">Projekt links auswählen</div>
          ) : (
            <>
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
                {tab === "terminal" && <TerminalPanel key={selectedId} projectId={selectedId} />}
                {tab === "logs" && <LogPanel key={selectedId} projectId={selectedId} />}
                {tab === "files" && (
                  <div className="files-tab">
                    <FileTree projectId={selectedId} onSelectFile={setSelectedFile} />
                    <FileViewer projectId={selectedId} path={selectedFile} />
                  </div>
                )}
              </div>
            </>
          ))}
      </main>
    </div>
  );
}
