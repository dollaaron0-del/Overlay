import { useEffect, useState } from "react";
import type { ProjectSummary } from "@overlay/shared";
import { api } from "../api/client";
import { STATIC_APPS } from "./apps";
import { AppIcon } from "./AppIcon";
import { FolderIcon } from "./FolderIcon";
import { FolderView } from "./FolderView";
import { AddProjectForm } from "../layout/AddProjectForm";
import { useHomescreenLayout } from "./homescreen-layout";
import { useAppBadges } from "./useAppBadges";
import { SystemStatsWidget } from "./widgets/SystemStatsWidget";
import { BackupWidget } from "./widgets/BackupWidget";
import { defaultProjectIcon } from "./project-icon";

interface IconItem {
  id: string;
  title: string;
  icon: string;
  statusDot?: ProjectSummary["status"];
  kind: "project" | "app";
  /** Only set for projects — which home-screen section this tile belongs in. */
  homeSection?: ProjectSummary["homeSection"];
  /** Where a Dashboard tile links out to — always set for systemd/pm2-root, optionally set for a normal project too (see dashboardLinkItems). */
  externalUrl?: string;
  /**
   * True for the synthetic second tile a normal project gets in the
   * Dashboards section when it has both a Terminal-section tile and an
   * externalUrl (see dashboardLinkItems below) — distinguishes it from that
   * project's own Terminal-section tile so delete/rename always act on the
   * real project, never on this link-only view of it.
   */
  isDashboardLink?: boolean;
}

function isFolderId(id: string): boolean {
  return id.startsWith("folder:");
}

// Static apps that are used rarely enough to visually recede behind
// projects and everyday apps, rather than competing for attention.
const SMALL_APP_IDS = new Set(["activity", "settings"]);

// Sicherheit and Cockpit have a permanent slot in the Sidebar, so they're
// left out of the grid to avoid showing the same destination twice.
const SIDEBAR_APP_IDS = new Set(["security", "cockpit"]);

// Schnellnotiz is a quick action, not a destination worth its own tile —
// it stays reachable via Spotlight (Cmd+K) but no longer clutters the grid.
const SPOTLIGHT_ONLY_APP_IDS = new Set(["quickcapture"]);

// Emmy is the centerpiece of the overlay — it gets the biggest tile on the
// homescreen, bigger even than project tiles.
const HERO_APP_IDS = new Set(["emmy"]);

export function HomeScreen({
  projects,
  onOpenProject,
  onOpenApp,
  onOpenControlCenter,
}: {
  projects: ProjectSummary[];
  onOpenProject: (id: string) => void;
  onOpenApp: (id: string) => void;
  onOpenControlCenter: () => void;
}) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [openFolderId, setOpenFolderId] = useState<string | null>(null);

  // A project Overlay itself runs (Terminal-section tile) can *also* carry a
  // dashboard link — e.g. a bot with both a codebase worth a terminal and its
  // own web UI worth a one-click link. Rather than forcing a choice between
  // the two (like systemd/pm2-root projects, whose one tile only ever links
  // out — see openItem below), it keeps its Terminal-section tile and gets a
  // second, synthetic tile in the Dashboards section for the link.
  const dashboardLinkItems: IconItem[] = projects
    .filter((p) => p.homeSection === "terminal" && p.externalUrl)
    .map((p) => ({
      id: `dashlink:${p.id}`,
      title: p.name || p.dirName,
      icon: p.icon || defaultProjectIcon(p.id),
      statusDot: p.status,
      kind: "project" as const,
      homeSection: "dashboard" as const,
      externalUrl: p.externalUrl,
      isDashboardLink: true,
    }));

  const items: IconItem[] = [
    ...projects.map((p) => ({
      id: `project:${p.id}`,
      title: p.name || p.dirName,
      icon: p.icon || defaultProjectIcon(p.id),
      statusDot: p.status,
      kind: "project" as const,
      homeSection: p.homeSection,
      externalUrl: p.externalUrl,
    })),
    ...dashboardLinkItems,
    ...STATIC_APPS.filter((a) => !SIDEBAR_APP_IDS.has(a.id) && !SPOTLIGHT_ONLY_APP_IDS.has(a.id)).map((a) => ({
      id: `app:${a.id}`,
      title: a.title,
      icon: a.icon,
      kind: "app" as const,
    })),
  ];
  const itemsById = new Map(items.map((item) => [item.id, item]));

  const { visibleIds, hiddenIds, folders, reorder, hide, unhide, groupIntoFolder, dissolveFolder, removeFromFolder } =
    useHomescreenLayout(items.map((i) => i.id));
  const foldersById = new Map(folders.map((f) => [f.id, f]));
  const badges = useAppBadges();

  // A folder counts as "Dashboards" only if every one of its members is a
  // dashboard-kind project — a folder mixing dashboards with terminal
  // projects or apps falls back to Projekt-Terminals rather than silently
  // hiding non-dashboard members from view.
  const isDashboardId = (id: string): boolean => {
    if (isFolderId(id)) {
      const folder = foldersById.get(id);
      return !!folder && folder.memberIds.length > 0 && folder.memberIds.every(isDashboardId);
    }
    return itemsById.get(id)?.homeSection === "dashboard";
  };
  const dashboardIds = visibleIds.filter(isDashboardId);
  const terminalIds = visibleIds.filter((id) => !isDashboardId(id));

  useEffect(() => {
    if (!draggingId) return;

    const onPointerMove = (e: globalThis.PointerEvent) => {
      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-icon-id]");
      const targetId = target?.dataset.iconId;
      if (targetId && targetId !== draggingId) reorder(draggingId, targetId);
    };
    const onPointerUp = () => setDraggingId(null);

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [draggingId, reorder]);

  const deleteProject = async (projectId: string, label: string) => {
    if (!confirm(`"${label}" aus Overlay entfernen? Die Dateien und der Prozess bleiben erhalten.`)) return;
    await api.delete(`/api/projects/${projectId}`);
  };

  const openItem = (id: string) => {
    const item = itemsById.get(id);
    if (!item) return;
    if (item.kind === "project") {
      // Dashboard tiles link straight out to the app they represent instead
      // of detouring through the project's internal workspace — that's the
      // whole point of a Dashboard tile, whether it's a systemd/pm2-root
      // project's only tile or a normal project's synthetic second tile (see
      // dashboardLinkItems above). Management (start/stop/logs/terminal) is
      // still reachable via the project's own Terminal-section tile, if it
      // has one, or Spotlight.
      if (item.isDashboardLink || (item.homeSection === "dashboard" && item.externalUrl)) {
        if (item.externalUrl) window.open(item.externalUrl, "_blank", "noopener,noreferrer");
        return;
      }
      onOpenProject(id.slice("project:".length));
    } else {
      onOpenApp(id.slice("app:".length));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exitEditMode = () => {
    setEditMode(false);
    setSelectedIds(new Set());
  };

  const groupSelected = () => {
    const name = window.prompt("Ordnername:", "Neuer Ordner");
    if (!name || !name.trim()) return;
    groupIntoFolder(name.trim(), [...selectedIds]);
    setSelectedIds(new Set());
  };

  const openFolder = foldersById.get(openFolderId ?? "");

  const renderIcon = (id: string) => {
    if (isFolderId(id)) {
      const folder = foldersById.get(id);
      if (!folder) return null;
      return (
        <FolderIcon
          key={id}
          id={id}
          name={folder.name}
          previewIcons={folder.memberIds.map((m) => itemsById.get(m)?.icon ?? "❓")}
          editMode={editMode}
          onOpen={() => setOpenFolderId(id)}
          onHide={() => hide(id)}
          onLongPress={() => setEditMode(true)}
          onDragStart={setDraggingId}
        />
      );
    }
    const item = itemsById.get(id);
    if (!item) return null;
    return (
      <AppIcon
        key={id}
        id={id}
        icon={item.icon}
        label={item.title}
        statusDot={item.statusDot}
        badge={badges[id]}
        editMode={editMode}
        selected={selectedIds.has(id)}
        large={item.kind === "project"}
        small={item.kind === "app" && SMALL_APP_IDS.has(id.slice("app:".length))}
        hero={item.kind === "app" && HERO_APP_IDS.has(id.slice("app:".length))}
        onToggleSelect={() => toggleSelect(id)}
        onClick={() => openItem(id)}
        onLongPress={() => setEditMode(true)}
        onHide={() => hide(id)}
        onDelete={
          item.kind === "project" && !item.isDashboardLink
            ? () => deleteProject(id.slice("project:".length), item.title)
            : undefined
        }
        onDragStart={setDraggingId}
      />
    );
  };

  return (
    <div className="home-screen">
      <section className="home-section">
        <h2 className="home-section-title">Widgets</h2>
        <div className="home-widget-grid">
          <SystemStatsWidget onOpen={() => onOpenApp("cockpit")} />
          <BackupWidget onOpen={onOpenControlCenter} />
        </div>
      </section>

      <div className="home-app-grid-header">
        {editMode ? (
          <>
            {selectedIds.size >= 2 && (
              <button className="home-group-button" onClick={groupSelected}>
                In Ordner gruppieren ({selectedIds.size})
              </button>
            )}
            <button className="home-edit-done-button" onClick={exitEditMode}>
              Fertig
            </button>
          </>
        ) : (
          <span />
        )}
      </div>

      {(editMode || dashboardIds.length > 0) && (
        <section className="home-section">
          <h2 className="home-section-title">Dashboards</h2>
          <div className="home-app-grid">{dashboardIds.map(renderIcon)}</div>
        </section>
      )}

      <section className="home-section">
        <h2 className="home-section-title">Projekt-Terminals</h2>
        <div className="home-app-grid">
          {terminalIds.map(renderIcon)}
          {!editMode && (
            <AppIcon
              id="__add__"
              icon="➕"
              label="Hinzufügen"
              editMode={false}
              onClick={() => setShowAddForm(true)}
              onLongPress={() => undefined}
              onDragStart={() => undefined}
            />
          )}
        </div>
      </section>

      {editMode && hiddenIds.length > 0 && (
        <div className="home-hidden-section">
          <h3>Ausgeblendet</h3>
          <div className="home-app-grid">
            {hiddenIds.map((id) => {
              const folder = isFolderId(id) ? foldersById.get(id) : undefined;
              const label = folder ? folder.name : itemsById.get(id)?.title;
              const icon = folder ? (folder.memberIds.map((m) => itemsById.get(m)?.icon ?? "❓")[0] ?? "🗂") : itemsById.get(id)?.icon;
              if (!label) return null;
              return (
                <button key={id} className="os-app-icon home-hidden-icon" onClick={() => unhide(id)}>
                  <span className="os-app-icon-glyph">{icon}</span>
                  <span className="os-app-icon-label">{label}</span>
                  <span className="home-hidden-icon-restore">Wieder einblenden</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {openFolder && (
        <FolderView
          folderName={openFolder.name}
          memberIds={openFolder.memberIds}
          itemsById={itemsById}
          editMode={editMode}
          onOpenItem={(id) => {
            setOpenFolderId(null);
            openItem(id);
          }}
          onClose={() => setOpenFolderId(null)}
          onRemoveMember={(memberId) => removeFromFolder(openFolder.id, memberId)}
          onDissolve={() => {
            dissolveFolder(openFolder.id);
            setOpenFolderId(null);
          }}
        />
      )}

      {showAddForm && (
        <div className="home-modal-backdrop" onClick={() => setShowAddForm(false)}>
          <div onClick={(e) => e.stopPropagation()}>
            <AddProjectForm onClose={() => setShowAddForm(false)} onAdded={() => setShowAddForm(false)} />
          </div>
        </div>
      )}
    </div>
  );
}
