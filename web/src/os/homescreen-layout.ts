import { useEffect, useState } from "react";

export const HOMESCREEN_LAYOUT_STORAGE_KEY = "overlay-homescreen-layout";
const STORAGE_KEY = HOMESCREEN_LAYOUT_STORAGE_KEY;

interface StoredLayout {
  order: string[];
  hidden: string[];
}

function readStored(): StoredLayout {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { order: [], hidden: [] };
    const parsed = JSON.parse(raw) as Partial<StoredLayout>;
    return {
      order: Array.isArray(parsed.order) ? parsed.order : [],
      hidden: Array.isArray(parsed.hidden) ? parsed.hidden : [],
    };
  } catch {
    return { order: [], hidden: [] };
  }
}

function applyOrder(ids: string[], order: string[]): string[] {
  const known = new Set(ids);
  const ordered = order.filter((id) => known.has(id));
  const missing = ids.filter((id) => !ordered.includes(id));
  return [...ordered, ...missing];
}

/**
 * Persists the user's home-screen icon order and hidden set in
 * localStorage — a personal display preference, no backend involved.
 * `allIds` is the full, current set of icon ids (live projects + static
 * apps, recomputed by the caller each render), so new/removed icons are
 * reconciled automatically: new ones are appended at the end, removed ones
 * simply drop out of the stored arrays without any explicit cleanup.
 */
export function useHomescreenLayout(allIds: string[]) {
  const [layout, setLayout] = useState<StoredLayout>(readStored);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  }, [layout]);

  const ordered = applyOrder(allIds, layout.order);
  const visibleIds = ordered.filter((id) => !layout.hidden.includes(id));
  const hiddenIds = ordered.filter((id) => layout.hidden.includes(id));

  const reorder = (draggedId: string, targetId: string) => {
    setLayout((prev) => {
      const current = applyOrder(allIds, prev.order);
      const from = current.indexOf(draggedId);
      const to = current.indexOf(targetId);
      if (from === -1 || to === -1 || from === to) return prev;
      const next = [...current];
      next.splice(from, 1);
      next.splice(to, 0, draggedId);
      return { ...prev, order: next };
    });
  };

  const hide = (id: string) => {
    setLayout((prev) => (prev.hidden.includes(id) ? prev : { ...prev, hidden: [...prev.hidden, id] }));
  };

  const unhide = (id: string) => {
    setLayout((prev) => ({ ...prev, hidden: prev.hidden.filter((h) => h !== id) }));
  };

  return { visibleIds, hiddenIds, reorder, hide, unhide };
}
