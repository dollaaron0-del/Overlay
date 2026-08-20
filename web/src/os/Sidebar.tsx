/**
 * The single app-level navigation surface. Replaces the old TopBar icon
 * buttons + bottom Dock, which exposed the same three actions (Suche,
 * Benachrichtigungen, Kontrollzentrum) twice. Also gives Cockpit and
 * Sicherheit a permanent, one-tap slot instead of living as grid tiles.
 */
export function Sidebar({
  onHome,
  onOpenApp,
  onSearch,
  onNotifications,
  onControlCenter,
  hasAlerts,
}: {
  onHome: () => void;
  onOpenApp: (id: string) => void;
  onSearch: () => void;
  onNotifications: () => void;
  onControlCenter: () => void;
  hasAlerts: boolean;
}) {
  return (
    <nav className="os-sidebar">
      <button className="os-sidebar-brand" onClick={onHome} aria-label="Startbildschirm">
        <span className="os-sidebar-brand-icon">🏠</span>
        <span className="os-sidebar-brand-label">Overlay</span>
      </button>

      <div className="os-sidebar-section">
        <button className="os-sidebar-button" onClick={() => onOpenApp("security")}>
          <span className="os-sidebar-icon">🛡</span>
          <span className="os-sidebar-label">Sicherheit</span>
        </button>
        <button className="os-sidebar-button" onClick={() => onOpenApp("cockpit")}>
          <span className="os-sidebar-icon">🖥️</span>
          <span className="os-sidebar-label">Cockpit</span>
        </button>
      </div>

      <div className="os-sidebar-section os-sidebar-section--push-end">
        <button className="os-sidebar-button" onClick={onSearch} aria-label="Suche">
          <span className="os-sidebar-icon">🔍</span>
          <span className="os-sidebar-label">Suche</span>
        </button>
        <button className="os-sidebar-button" onClick={onNotifications} aria-label="Benachrichtigungen">
          <span className="os-sidebar-icon">
            🔔
            {hasAlerts && <span className="os-sidebar-badge" />}
          </span>
          <span className="os-sidebar-label">Aktivität</span>
        </button>
        <button className="os-sidebar-button" onClick={onControlCenter} aria-label="Kontrollzentrum">
          <span className="os-sidebar-icon">🎛</span>
          <span className="os-sidebar-label">Steuerung</span>
        </button>
      </div>
    </nav>
  );
}
