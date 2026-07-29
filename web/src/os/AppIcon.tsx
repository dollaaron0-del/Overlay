import { useRef, type PointerEvent } from "react";

const LONG_PRESS_MS = 500;

export function AppIcon({
  id,
  icon,
  label,
  statusDot,
  onClick,
  editMode,
  onLongPress,
  onHide,
  onDragStart,
}: {
  id: string;
  icon: string;
  label: string;
  statusDot?: "online" | "stopped" | "errored" | "unknown";
  onClick: () => void;
  editMode: boolean;
  onLongPress: () => void;
  onHide?: () => void;
  onDragStart: (id: string) => void;
}) {
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const moved = useRef(false);

  const clearTimer = () => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };

  const handlePointerDown = (e: PointerEvent) => {
    if (e.button !== undefined && e.button !== 0) return;
    moved.current = false;
    if (editMode) {
      onDragStart(id);
      return;
    }
    pressTimer.current = setTimeout(() => {
      if (!moved.current) onLongPress();
    }, LONG_PRESS_MS);
  };

  const handlePointerMove = () => {
    moved.current = true;
    clearTimer();
  };

  const handleClick = () => {
    if (editMode) return; // taps don't navigate while rearranging, matching iOS jiggle mode
    onClick();
  };

  return (
    <div
      className={`os-app-icon-wrapper ${editMode ? "edit-mode" : ""}`}
      data-icon-id={id}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={clearTimer}
      onPointerCancel={clearTimer}
    >
      {editMode && onHide && (
        <button className="os-app-icon-hide-button" onClick={onHide} aria-label={`${label} ausblenden`}>
          ✕
        </button>
      )}
      <button className="os-app-icon" onClick={handleClick} tabIndex={editMode ? -1 : 0}>
        <span className="os-app-icon-glyph">
          {icon}
          {statusDot && <span className={`status-dot status-${statusDot} os-app-icon-status`} />}
        </span>
        <span className="os-app-icon-label">{label}</span>
      </button>
    </div>
  );
}
