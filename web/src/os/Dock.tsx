export function Dock({
  onSearch,
  onNotifications,
  onControlCenter,
  hasAlerts,
}: {
  onSearch: () => void;
  onNotifications: () => void;
  onControlCenter: () => void;
  hasAlerts: boolean;
}) {
  return (
    <nav className="os-dock">
      <button className="os-dock-button" onClick={onSearch} aria-label="Suche">
        <span className="os-dock-icon">🔍</span>
        <span className="os-dock-label">Suche</span>
      </button>
      <button className="os-dock-button" onClick={onNotifications} aria-label="Benachrichtigungen">
        <span className="os-dock-icon">
          🔔
          {hasAlerts && <span className="os-topbar-badge" />}
        </span>
        <span className="os-dock-label">Aktivität</span>
      </button>
      <button className="os-dock-button" onClick={onControlCenter} aria-label="Kontrollzentrum">
        <span className="os-dock-icon">🎛</span>
        <span className="os-dock-label">Steuerung</span>
      </button>
    </nav>
  );
}
