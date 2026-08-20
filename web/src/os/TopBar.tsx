export function TopBar({ title, showBack, onBack }: { title: string; showBack: boolean; onBack: () => void }) {
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
      <div className="os-topbar-right" />
    </header>
  );
}
