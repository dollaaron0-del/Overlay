import { useRef, type PointerEvent } from "react";

const LONG_PRESS_MS = 500;

/**
 * Shared long-press-to-jiggle + drag-start detection for home-screen tiles
 * (AppIcon and FolderIcon): a short tap does nothing special, holding still
 * for LONG_PRESS_MS triggers onLongPress (enters edit mode), and — once
 * already in edit mode — a pointerdown immediately starts a drag instead.
 */
export function useLongPressDrag({
  id,
  editMode,
  onLongPress,
  onDragStart,
}: {
  id: string;
  editMode: boolean;
  onLongPress: () => void;
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

  return {
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: clearTimer,
    onPointerCancel: clearTimer,
  };
}
