export function TopBar({
  title,
  showBack,
  onBack,
  onSearch,
  onNotifications,
  onControlCenter,
  hasAlerts,
}: {
  title: string;
  showBack: boolean;
  onBack: () => void;
  onSearch: () => void;
  onNotifications: () => void;
  onControlCenter: () => void;
  hasAlerts: boolean;
}) {
  return (
    <header className="os-topbar">
      <div className="os-topbar-left">
        {showBack ? (
          <button className="os-topbar-back" onClick={onBack}>
            ← Home
          </button>
        ) : (
          <span className="os-topbar-brand">Overlay</span>
        )}
      </div>
      <div className="os-topbar-title">{showBack ? title : ""}</div>
      <div className="os-topbar-right">
        <button className="os-topbar-icon-button" onClick={onSearch} title="Suche" aria-label="Suche">
          🔍
        </button>
        <button
          className="os-topbar-icon-button"
          onClick={onNotifications}
          title="Benachrichtigungen"
          aria-label="Benachrichtigungen"
        >
          🔔
          {hasAlerts && <span className="os-topbar-badge" />}
        </button>
        <button
          className="os-topbar-icon-button"
          onClick={onControlCenter}
          title="Kontrollzentrum"
          aria-label="Kontrollzentrum"
        >
          🎛
        </button>
      </div>
    </header>
  );
}
