import { useCallback, useEffect, useMemo, useState } from "react";

export const HOMESCREEN_LAYOUT_STORAGE_KEY = "overlay-homescreen-layout";
const STORAGE_KEY = HOMESCREEN_LAYOUT_STORAGE_KEY;

export interface HomescreenFolder {
  id: string;
  name: string;
  memberIds: string[];
}

interface StoredLayout {
  order: string[];
  hidden: string[];
  folders: HomescreenFolder[];
}

function readStored(): StoredLayout {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { order: [], hidden: [], folders: [] };
    const parsed = JSON.parse(raw) as Partial<StoredLayout>;
    return {
      order: Array.isArray(parsed.order) ? parsed.order : [],
      hidden: Array.isArray(parsed.hidden) ? parsed.hidden : [],
      folders: Array.isArray(parsed.folders) ? parsed.folders : [],
    };
  } catch {
    return { order: [], hidden: [], folders: [] };
  }
}

function applyOrder(ids: string[], order: string[]): string[] {
  const known = new Set(ids);
  const ordered = order.filter((id) => known.has(id));
  const missing = ids.filter((id) => !ordered.includes(id));
  return [...ordered, ...missing];
}

function makeFolderId(): string {
  return `folder:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Icon ids not inside any folder, plus the folders themselves — the set that actually sits at the top level of the homescreen. */
function topLevelIds(allIds: string[], folders: HomescreenFolder[]): string[] {
  const grouped = new Set(folders.flatMap((f) => f.memberIds));
  return [...allIds.filter((id) => !grouped.has(id)), ...folders.map((f) => f.id)];
}

/**
 * Persists the user's home-screen icon order, hidden set, and folders in
 * localStorage — a personal display preference, no backend involved.
 * `allIds` is the full, current set of raw icon ids (live projects + static
 * apps, recomputed by the caller each render), so new/removed icons are
 * reconciled automatically: new ones are appended at the end, removed ones
 * simply drop out of the stored arrays without any explicit cleanup.
 */
export function useHomescreenLayout(allIds: string[]) {
  const [layout, setLayout] = useState<StoredLayout>(readStored);

  // The caller recomputes `allIds` fresh every render (it's a live `.map()`
  // over projects/apps), so its reference changes even when its content
  // doesn't — e.g. on every status-websocket tick. Keying off the joined
  // content instead of the array reference keeps `stableIds` (and anything
  // that depends on it, like `reorder` below) referentially stable across
  // renders that don't actually add/remove/reorder an icon.
  const idsKey = allIds.join("|");
  // eslint/exhaustive-deps would normally want `allIds` here, but the whole
  // point is to depend on its content (`idsKey`), not its reference.
  const stableIds = useMemo(() => allIds, [idsKey]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  }, [layout]);

  const ordered = applyOrder(topLevelIds(stableIds, layout.folders), layout.order);
  const visibleIds = ordered.filter((id) => !layout.hidden.includes(id));
  const hiddenIds = ordered.filter((id) => layout.hidden.includes(id));

  // Wrapped in useCallback (keyed off the now-stable `stableIds`) because
  // HomeScreen puts this in a useEffect dependency array to track a drag
  // gesture across pointer moves — without a stable reference, that effect
  // would tear down and re-attach its window pointermove/pointerup listeners
  // on every unrelated re-render that happens mid-drag.
  const reorder = useCallback(
    (draggedId: string, targetId: string) => {
      setLayout((prev) => {
        const current = applyOrder(topLevelIds(stableIds, prev.folders), prev.order);
        const from = current.indexOf(draggedId);
        const to = current.indexOf(targetId);
        if (from === -1 || to === -1 || from === to) return prev;
        const next = [...current];
        next.splice(from, 1);
        next.splice(to, 0, draggedId);
        return { ...prev, order: next };
      });
    },
    [stableIds],
  );

  const hide = (id: string) => {
    setLayout((prev) => (prev.hidden.includes(id) ? prev : { ...prev, hidden: [...prev.hidden, id] }));
  };

  const unhide = (id: string) => {
    setLayout((prev) => ({ ...prev, hidden: prev.hidden.filter((h) => h !== id) }));
  };

  /** Groups the given top-level ids (icons or even other folders) into a new named folder. */
  const groupIntoFolder = (name: string, memberIds: string[]) => {
    setLayout((prev) => {
      const folderId = makeFolderId();
      const remainingOrder = applyOrder(topLevelIds(allIds, prev.folders), prev.order).filter(
        (id) => !memberIds.includes(id),
      );
      return {
        ...prev,
        order: [...remainingOrder, folderId],
        folders: [...prev.folders, { id: folderId, name, memberIds }],
      };
    });
  };

  const dissolveFolder = (folderId: string) => {
    setLayout((prev) => {
      const folder = prev.folders.find((f) => f.id === folderId);
      if (!folder) return prev;
      return {
        ...prev,
        order: [...prev.order.filter((id) => id !== folderId), ...folder.memberIds],
        folders: prev.folders.filter((f) => f.id !== folderId),
      };
    });
  };

  const removeFromFolder = (folderId: string, memberId: string) => {
    setLayout((prev) => {
      const folder = prev.folders.find((f) => f.id === folderId);
      if (!folder) return prev;
      const remaining = folder.memberIds.filter((id) => id !== memberId);
      if (remaining.length <= 1) {
        // A folder with 0 or 1 members left isn't useful — dissolve it,
        // same as iOS does automatically in this situation.
        return {
          ...prev,
          order: [...prev.order.filter((id) => id !== folderId), ...folder.memberIds],
          folders: prev.folders.filter((f) => f.id !== folderId),
        };
      }
      return {
        ...prev,
        order: [...prev.order, memberId],
        folders: prev.folders.map((f) => (f.id === folderId ? { ...f, memberIds: remaining } : f)),
      };
    });
  };

  return {
    visibleIds,
    hiddenIds,
    folders: layout.folders,
    reorder,
    hide,
    unhide,
    groupIntoFolder,
    dissolveFolder,
    removeFromFolder,
  };
}
