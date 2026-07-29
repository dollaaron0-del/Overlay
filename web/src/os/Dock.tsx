export function Dock({
  onSearch,
  onNotifications,
  hasAlerts,
}: {
  onSearch: () => void;
  onNotifications: () => void;
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
    </nav>
  );
}
