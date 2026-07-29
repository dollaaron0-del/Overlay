import { useEffect, useRef, useState } from "react";
import type { ProjectSummary } from "@overlay/shared";
import { STATIC_APPS } from "./apps";
import { AppIcon } from "./AppIcon";
import { AddProjectForm } from "../layout/AddProjectForm";
import { useHomescreenLayout } from "./homescreen-layout";
import { SystemStatsWidget } from "./widgets/SystemStatsWidget";
import { SecurityWidget } from "./widgets/SecurityWidget";
import { BackupWidget } from "./widgets/BackupWidget";
import { OllamaWidget } from "./widgets/OllamaWidget";

interface IconItem {
  id: string;
  title: string;
  icon: string;
  statusDot?: ProjectSummary["status"];
  kind: "project" | "app";
}

export function HomeScreen({
  projects,
  onOpenProject,
  onOpenApp,
}: {
  projects: ProjectSummary[];
  onOpenProject: (id: string) => void;
  onOpenApp: (id: string) => void;
}) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const items: IconItem[] = [
    ...projects.map((p) => ({ id: `project:${p.id}`, title: p.dirName, icon: "📁", statusDot: p.status, kind: "project" as const })),
    ...STATIC_APPS.map((a) => ({ id: `app:${a.id}`, title: a.title, icon: a.icon, kind: "app" as const })),
  ];
  const itemsById = new Map(items.map((item) => [item.id, item]));

  const { visibleIds, hiddenIds, reorder, hide, unhide } = useHomescreenLayout(items.map((i) => i.id));

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

  const open = (item: IconItem) => {
    if (item.kind === "project") onOpenProject(item.id.slice("project:".length));
    else onOpenApp(item.id.slice("app:".length));
  };

  return (
    <div className="home-screen">
      {!editMode && (
        <div className="home-widgets">
          <SystemStatsWidget />
          <SecurityWidget onOpen={() => onOpenApp("security")} />
          <BackupWidget />
          <OllamaWidget />
        </div>
      )}

      <div className="home-app-grid-header">
        {editMode ? (
          <button className="home-edit-done-button" onClick={() => setEditMode(false)}>
            Fertig
          </button>
        ) : (
          <span />
        )}
      </div>

      <div className="home-app-grid" ref={gridRef}>
        {visibleIds.map((id) => {
          const item = itemsById.get(id);
          if (!item) return null;
          return (
            <AppIcon
              key={id}
              id={id}
              icon={item.icon}
              label={item.title}
              statusDot={item.statusDot}
              editMode={editMode}
              onClick={() => open(item)}
              onLongPress={() => setEditMode(true)}
              onHide={() => hide(id)}
              onDragStart={setDraggingId}
            />
          );
        })}
        {!editMode && <AppIcon id="__add__" icon="➕" label="Hinzufügen" editMode={false} onClick={() => setShowAddForm(true)} onLongPress={() => undefined} onDragStart={() => undefined} />}
      </div>

      {editMode && hiddenIds.length > 0 && (
        <div className="home-hidden-section">
          <h3>Ausgeblendet</h3>
          <div className="home-app-grid">
            {hiddenIds.map((id) => {
              const item = itemsById.get(id);
              if (!item) return null;
              return (
                <button key={id} className="os-app-icon home-hidden-icon" onClick={() => unhide(id)}>
                  <span className="os-app-icon-glyph">{item.icon}</span>
                  <span className="os-app-icon-label">{item.title}</span>
                  <span className="home-hidden-icon-restore">Wieder einblenden</span>
                </button>
              );
            })}
          </div>
        </div>
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
