import { useMemo, useState } from "react";
import { ICON_CATEGORIES, searchIcons } from "./icon-catalog";

const RECENT_KEY = "overlay.icon-picker.recent";
const RECENT_LIMIT = 8;

function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string").slice(0, RECENT_LIMIT) : [];
  } catch {
    return [];
  }
}

function rememberIcon(icon: string): void {
  try {
    const next = [icon, ...readRecent().filter((i) => i !== icon)].slice(0, RECENT_LIMIT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // A blocked/full localStorage costs the recents list, not the icon change.
  }
}

/**
 * Icon chooser for a project tile: the full catalog by category, a German
 * keyword search, the icons picked most recently, and a free-text field for
 * anything the catalog doesn't cover (the server accepts up to 16 chars, so a
 * multi-codepoint emoji or a short text badge like "v2" works too).
 */
export function IconPicker({
  value,
  onSelect,
  onReset,
  onClose,
}: {
  /** Currently active icon, highlighted in the grid. */
  value: string;
  onSelect: (icon: string) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("alle");
  const [custom, setCustom] = useState("");
  const [recent, setRecent] = useState<string[]>(() => readRecent());

  const results = useMemo(() => {
    // A search spans the whole catalog — narrowing it to the selected
    // category as well would silently hide matches the user can see are
    // missing but not explain why.
    if (query.trim()) return searchIcons(query);
    if (category === "alle") return ICON_CATEGORIES.flatMap((c) => c.icons.map(([icon]) => icon));
    return ICON_CATEGORIES.find((c) => c.id === category)?.icons.map(([icon]) => icon) ?? [];
  }, [query, category]);

  const pick = (icon: string) => {
    rememberIcon(icon);
    setRecent(readRecent());
    onSelect(icon);
  };

  const applyCustom = () => {
    const trimmed = custom.trim();
    if (!trimmed) return;
    pick(trimmed.slice(0, 16));
    setCustom("");
  };

  return (
    <div className="icon-picker" role="dialog" aria-label="Icon auswählen">
      <div className="icon-picker-header">
        <input
          className="icon-picker-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Icon suchen (z. B. rakete, daten, sicher)"
          aria-label="Icon suchen"
          autoFocus
        />
        <button className="icon-picker-close" onClick={onClose} aria-label="Icon-Auswahl schließen">
          ✕
        </button>
      </div>

      {!query.trim() && (
        <div className="icon-picker-categories">
          <button
            className={`icon-picker-category ${category === "alle" ? "is-active" : ""}`}
            onClick={() => setCategory("alle")}
          >
            Alle
          </button>
          {ICON_CATEGORIES.map((c) => (
            <button
              key={c.id}
              className={`icon-picker-category ${category === c.id ? "is-active" : ""}`}
              onClick={() => setCategory(c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      {!query.trim() && recent.length > 0 && (
        <div className="icon-picker-section">
          <span className="icon-picker-section-title">Zuletzt benutzt</span>
          <div className="icon-picker-grid">
            {recent.map((icon) => (
              <button
                key={`recent-${icon}`}
                className={`icon-picker-option ${icon === value ? "is-active" : ""}`}
                onClick={() => pick(icon)}
                title={icon}
              >
                {icon}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="icon-picker-section">
        <div className="icon-picker-grid icon-picker-grid--scroll">
          {results.map((icon) => (
            <button
              key={icon}
              className={`icon-picker-option ${icon === value ? "is-active" : ""}`}
              onClick={() => pick(icon)}
              title={icon}
            >
              {icon}
            </button>
          ))}
          {results.length === 0 && <p className="icon-picker-empty">Kein Treffer — eigenes Icon unten eingeben.</p>}
        </div>
      </div>

      <div className="icon-picker-footer">
        <label className="icon-picker-custom">
          <span className="icon-picker-section-title">Eigenes</span>
          <input
            type="text"
            value={custom}
            maxLength={16}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyCustom();
              }
            }}
            placeholder="Emoji oder Kürzel"
            aria-label="Eigenes Icon"
          />
          <button onClick={applyCustom} disabled={!custom.trim()}>
            Übernehmen
          </button>
        </label>
        <button className="icon-picker-reset" onClick={onReset}>
          Zurücksetzen
        </button>
      </div>
    </div>
  );
}
