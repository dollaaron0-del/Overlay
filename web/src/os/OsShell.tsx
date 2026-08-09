import { useEffect, useMemo, useState } from "react";
import { useProjectsStatus } from "../layout/useProjectsStatus";
import { api, ApiError } from "../api/client";
import { TopBar } from "./TopBar";
import { HomeScreen } from "./HomeScreen";
import { Dock } from "./Dock";
import { Spotlight, type SpotlightItem } from "./Spotlight";
import { NotificationCenter } from "./NotificationCenter";
import { ControlCenter } from "./ControlCenter";
import { ProjectWorkspace } from "./ProjectWorkspace";
import { STATIC_APPS, getStaticApp } from "./apps";
import { defaultProjectIcon } from "./project-icon";
import { useAlertStatus } from "./useAlertStatus";

type OpenTarget = { kind: "project"; projectId: string } | { kind: "static"; appId: string } | null;

export function OsShell() {
  const projects = useProjectsStatus();
  const hasAlerts = useAlertStatus();
  const [open, setOpen] = useState<OpenTarget>(null);
  const [spotlightOpen, setSpotlightOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [controlCenterOpen, setControlCenterOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSpotlightOpen(true);
      } else if (e.key === "Escape") {
        setSpotlightOpen(false);
        setNotificationsOpen(false);
        setControlCenterOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const goHome = () => setOpen(null);
  const openProject = (projectId: string) => setOpen({ kind: "project", projectId });
  const openStaticApp = (appId: string) => setOpen({ kind: "static", appId });

  const spotlightItems: SpotlightItem[] = useMemo(() => {
    const navItems: SpotlightItem[] = [
      ...projects.map((p) => ({
        id: `project:${p.id}`,
        title: p.dirName,
        icon: p.icon || defaultProjectIcon(p.id),
        kind: "navigate" as const,
      })),
      ...STATIC_APPS.map((a) => ({ id: `app:${a.id}`, title: a.title, icon: a.icon, kind: "navigate" as const })),
    ];
    const actionItems: SpotlightItem[] = [
      { id: "action:scan", title: "Scan jetzt starten", icon: "🛡", kind: "action" },
      { id: "action:backup", title: "Backup jetzt starten", icon: "💾", kind: "action" },
      ...projects.flatMap((p) => [
        { id: `action:project:start:${p.id}`, title: `${p.dirName} starten`, icon: "▶️", kind: "action" as const },
        { id: `action:project:stop:${p.id}`, title: `${p.dirName} stoppen`, icon: "⏹", kind: "action" as const },
        { id: `action:project:restart:${p.id}`, title: `${p.dirName} neu starten`, icon: "🔁", kind: "action" as const },
      ]),
    ];
    return [...navItems, ...actionItems];
  }, [projects]);

  const projectActionPattern = /^action:project:(start|stop|restart):(.+)$/;

  const selectSpotlightItem = async (item: SpotlightItem): Promise<string | undefined> => {
    if (item.kind === "navigate") {
      setSpotlightOpen(false);
      if (item.id.startsWith("project:")) openProject(item.id.slice("project:".length));
      else openStaticApp(item.id.slice("app:".length));
      return undefined;
    }

    if (item.id === "action:scan") {
      try {
        await api.post("/api/security/scans/run");
        return "Scan gestartet — Ergebnis erscheint in der Sicherheit-App.";
      } catch (err) {
        return `Fehler: ${err instanceof ApiError ? (err.message ?? "unbekannt") : "unbekannt"}`;
      }
    }
    if (item.id === "action:backup") {
      try {
        await api.post("/api/backup/run");
        return "Backup gestartet — Status erscheint im Backups-Widget.";
      } catch (err) {
        if (err instanceof ApiError && err.message === "not_configured") return "Nicht konfiguriert (RESTIC_REPOSITORY leer).";
        if (err instanceof ApiError && err.message === "already_running") return "Läuft bereits.";
        return `Fehler: ${err instanceof ApiError ? (err.message ?? "unbekannt") : "unbekannt"}`;
      }
    }
    const projectMatch = projectActionPattern.exec(item.id);
    if (projectMatch) {
      const [, action, projectId] = projectMatch;
      await api.post(`/api/projects/${projectId}/${action}`);
      setSpotlightOpen(false);
    }
    return undefined;
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
        onControlCenter={() => setControlCenterOpen((v) => !v)}
        hasAlerts={hasAlerts}
      />
      <main className="os-main">{content}</main>
      {open === null && (
        <Dock
          onSearch={() => setSpotlightOpen(true)}
          onNotifications={() => setNotificationsOpen((v) => !v)}
          onControlCenter={() => setControlCenterOpen((v) => !v)}
          hasAlerts={hasAlerts}
        />
      )}
      {spotlightOpen && (
        <Spotlight items={spotlightItems} onSelect={selectSpotlightItem} onClose={() => setSpotlightOpen(false)} />
      )}
      {notificationsOpen && (
        <NotificationCenter onClose={() => setNotificationsOpen(false)} onOpenApp={openStaticApp} />
      )}
      {controlCenterOpen && <ControlCenter onClose={() => setControlCenterOpen(false)} />}
    </div>
  );
}
