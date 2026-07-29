import { useLongPressDrag } from "./useLongPressDrag";

export function FolderIcon({
  id,
  name,
  previewIcons,
  editMode,
  onOpen,
  onHide,
  onLongPress,
  onDragStart,
}: {
  id: string;
  name: string;
  previewIcons: string[];
  editMode: boolean;
  onOpen: () => void;
  onHide: () => void;
  onLongPress: () => void;
  onDragStart: (id: string) => void;
}) {
  const pressHandlers = useLongPressDrag({ id, editMode, onLongPress, onDragStart });

  const handleClick = () => {
    // Folders open their contents in both modes — editing what's inside
    // (removing members, dissolving) happens from within that view.
    onOpen();
  };

  return (
    <div className={`os-app-icon-wrapper ${editMode ? "edit-mode" : ""}`} data-icon-id={id} {...pressHandlers}>
      {editMode && (
        <button className="os-app-icon-hide-button" onClick={onHide} aria-label={`${name} ausblenden`}>
          ✕
        </button>
      )}
      <button className="os-app-icon" onClick={handleClick} tabIndex={editMode ? -1 : 0}>
        <span className="os-app-icon-glyph os-folder-glyph">
          {previewIcons.slice(0, 4).map((icon, i) => (
            <span key={i}>{icon}</span>
          ))}
        </span>
        <span className="os-app-icon-label">{name}</span>
      </button>
    </div>
  );
}
