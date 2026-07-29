import { useLongPressDrag } from "./useLongPressDrag";

export function AppIcon({
  id,
  icon,
  label,
  statusDot,
  badge,
  onClick,
  editMode,
  selected,
  onToggleSelect,
  onLongPress,
  onHide,
  onDragStart,
}: {
  id: string;
  icon: string;
  label: string;
  statusDot?: "online" | "stopped" | "errored" | "unknown";
  badge?: number;
  onClick: () => void;
  editMode: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  onLongPress: () => void;
  onHide?: () => void;
  onDragStart: (id: string) => void;
}) {
  const pressHandlers = useLongPressDrag({ id, editMode, onLongPress, onDragStart });

  const handleClick = () => {
    if (editMode) {
      onToggleSelect?.();
      return;
    }
    onClick();
  };

  return (
    <div className={`os-app-icon-wrapper ${editMode ? "edit-mode" : ""}`} data-icon-id={id} {...pressHandlers}>
      {editMode && onHide && (
        <button className="os-app-icon-hide-button" onClick={onHide} aria-label={`${label} ausblenden`}>
          ✕
        </button>
      )}
      <button className={`os-app-icon ${selected ? "selected" : ""}`} onClick={handleClick} tabIndex={editMode ? -1 : 0}>
        <span className="os-app-icon-glyph">
          {icon}
          {statusDot && <span className={`status-dot status-${statusDot} os-app-icon-status`} />}
          {!!badge && <span className="os-app-icon-badge">{badge > 99 ? "99+" : badge}</span>}
          {editMode && selected && <span className="os-app-icon-selected-check">✓</span>}
        </span>
        <span className="os-app-icon-label">{label}</span>
      </button>
    </div>
  );
}
