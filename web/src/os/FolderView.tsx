export function FolderView({
  folderName,
  memberIds,
  itemsById,
  editMode,
  onOpenItem,
  onClose,
  onRemoveMember,
  onDissolve,
}: {
  folderName: string;
  memberIds: string[];
  itemsById: Map<string, { title: string; icon: string }>;
  editMode: boolean;
  onOpenItem: (id: string) => void;
  onClose: () => void;
  onRemoveMember: (memberId: string) => void;
  onDissolve: () => void;
}) {
  return (
    <div className="home-modal-backdrop" onClick={onClose}>
      <div className="folder-view" onClick={(e) => e.stopPropagation()}>
        <div className="notification-header">
          <h3>{folderName}</h3>
          <button className="close-button" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="home-app-grid folder-view-grid">
          {memberIds.map((id) => {
            const item = itemsById.get(id);
            if (!item) return null;
            return (
              <div key={id} className="folder-view-item">
                <button className="os-app-icon" onClick={() => onOpenItem(id)}>
                  <span className="os-app-icon-glyph">{item.icon}</span>
                  <span className="os-app-icon-label">{item.title}</span>
                </button>
                {editMode && (
                  <button
                    className="os-app-icon-hide-button folder-view-remove"
                    onClick={() => onRemoveMember(id)}
                    aria-label={`${item.title} aus Ordner entfernen`}
                  >
                    ✕
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {editMode && (
          <button className="folder-dissolve-button" onClick={onDissolve}>
            Ordner auflösen
          </button>
        )}
      </div>
    </div>
  );
}
