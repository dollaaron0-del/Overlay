import { useEffect, useMemo, useState } from "react";
import { useProjectsStatus } from "../layout/useProjectsStatus";
import { TopBar } from "./TopBar";
import { HomeScreen } from "./HomeScreen";
import { Dock } from "./Dock";
import { Spotlight, type SpotlightItem } from "./Spotlight";
import { NotificationCenter } from "./NotificationCenter";
import { ProjectWorkspace } from "./ProjectWorkspace";
import { STATIC_APPS, getStaticApp } from "./apps";
import { useAlertStatus } from "./useAlertStatus";

type OpenTarget = { kind: "project"; projectId: string } | { kind: "static"; appId: string } | null;

export function OsShell() {
  const projects = useProjectsStatus();
  const hasAlerts = useAlertStatus();
  const [open, setOpen] = useState<OpenTarget>(null);
  const [spotlightOpen, setSpotlightOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSpotlightOpen(true);
      } else if (e.key === "Escape") {
        setSpotlightOpen(false);
        setNotificationsOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const goHome = () => setOpen(null);
  const openProject = (projectId: string) => setOpen({ kind: "project", projectId });
  const openStaticApp = (appId: string) => setOpen({ kind: "static", appId });

  const spotlightItems: SpotlightItem[] = useMemo(
    () => [
      ...projects.map((p) => ({ id: `project:${p.id}`, title: p.dirName, icon: "📁" })),
      ...STATIC_APPS.map((a) => ({ id: `app:${a.id}`, title: a.title, icon: a.icon })),
    ],
    [projects],
  );

  const selectSpotlightItem = (item: SpotlightItem) => {
    setSpotlightOpen(false);
    if (item.id.startsWith("project:")) openProject(item.id.slice("project:".length));
    else openStaticApp(item.id.slice("app:".length));
  };

  let title = "Overlay";
  let content;
  if (open === null) {
    content = <HomeScreen projects={projects} onOpenProject={openProject} onOpenApp={openStaticApp} />;
  } else if (open.kind === "project") {
    const project = projects.find((p) => p.id === open.projectId);
    if (!project) {
      content = (
        <div className="empty-hint main-empty">
          Projekt nicht gefunden. <button onClick={goHome}>Zur Übersicht</button>
        </div>
      );
    } else {
      title = project.dirName;
      content = <ProjectWorkspace project={project} onRemoved={goHome} />;
    }
  } else {
    const app = getStaticApp(open.appId);
    title = app?.title ?? "Overlay";
    content = app?.render() ?? null;
  }

  return (
    <div className="os-shell">
      <TopBar
        title={title}
        showBack={open !== null}
        onBack={goHome}
        onSearch={() => setSpotlightOpen(true)}
        onNotifications={() => setNotificationsOpen((v) => !v)}
        hasAlerts={hasAlerts}
      />
      <main className="os-main">{content}</main>
      {open === null && (
        <Dock
          onSearch={() => setSpotlightOpen(true)}
          onNotifications={() => setNotificationsOpen((v) => !v)}
          hasAlerts={hasAlerts}
        />
      )}
      {spotlightOpen && (
        <Spotlight items={spotlightItems} onSelect={selectSpotlightItem} onClose={() => setSpotlightOpen(false)} />
      )}
      {notificationsOpen && (
        <NotificationCenter onClose={() => setNotificationsOpen(false)} onOpenApp={openStaticApp} />
      )}
    </div>
  );
}
