import { useEffect, useRef, useState } from "react";

export interface SpotlightItem {
  id: string;
  title: string;
  icon: string;
  kind: "navigate" | "action";
}

export function Spotlight({
  items,
  onSelect,
  onClose,
}: {
  items: SpotlightItem[];
  onSelect: (item: SpotlightItem) => Promise<string | undefined> | string | undefined;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = query ? items.filter((item) => item.title.toLowerCase().includes(query.toLowerCase())) : items;

  const select = async (item: SpotlightItem) => {
    const result = await onSelect(item);
    if (result) setMessage(result);
  };

  return (
    <div className="spotlight-backdrop" onClick={onClose}>
      <div className="spotlight-panel" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="spotlight-input"
          type="text"
          placeholder="Apps, Projekte und Aktionen durchsuchen…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && filtered.length > 0) void select(filtered[0]);
            if (e.key === "Escape") onClose();
          }}
        />
        {message ? (
          <div className="spotlight-message">
            <p>{message}</p>
            <button onClick={onClose}>Schließen</button>
          </div>
        ) : (
          <ul className="spotlight-results">
            {filtered.length === 0 && <li className="empty-hint">Keine Treffer.</li>}
            {filtered.map((item) => (
              <li key={item.id} onClick={() => void select(item)}>
                <span className="spotlight-result-icon">{item.icon}</span>
                <span>{item.title}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
