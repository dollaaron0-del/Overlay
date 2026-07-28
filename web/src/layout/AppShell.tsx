import { useState } from "react";
import { Sidebar } from "./Sidebar";
import { TerminalPanel } from "../terminal/TerminalPanel";
import { LogPanel } from "../logs/LogPanel";
import { FileTree } from "../files/FileTree";
import { FileViewer } from "../files/FileViewer";
import { SecurityDashboard } from "../security/SecurityDashboard";

type Tab = "terminal" | "logs" | "files";
type View = "project" | "security";

export function AppShell() {
  const [view, setView] = useState<View>("project");
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
      <Sidebar selectedId={selectedId} onSelect={selectProject} onShowSecurity={() => setView("security")} />
      <main className="main-panel">
        {view === "security" ? (
          <SecurityDashboard />
        ) : !selectedId ? (
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
        )}
      </main>
    </div>
  );
}
