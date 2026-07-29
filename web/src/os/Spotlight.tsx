import { useEffect, useRef, useState } from "react";

export interface SpotlightItem {
  id: string;
  title: string;
  icon: string;
}

export function Spotlight({
  items,
  onSelect,
  onClose,
}: {
  items: SpotlightItem[];
  onSelect: (item: SpotlightItem) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = query ? items.filter((item) => item.title.toLowerCase().includes(query.toLowerCase())) : items;

  return (
    <div className="spotlight-backdrop" onClick={onClose}>
      <div className="spotlight-panel" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="spotlight-input"
          type="text"
          placeholder="Apps und Projekte durchsuchen…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && filtered.length > 0) onSelect(filtered[0]);
            if (e.key === "Escape") onClose();
          }}
        />
        <ul className="spotlight-results">
          {filtered.length === 0 && <li className="empty-hint">Keine Treffer.</li>}
          {filtered.map((item) => (
            <li key={item.id} onClick={() => onSelect(item)}>
              <span className="spotlight-result-icon">{item.icon}</span>
              <span>{item.title}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
