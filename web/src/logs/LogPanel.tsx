import { useEffect, useMemo, useRef, useState } from "react";
import type { LogServerMessage } from "@overlay/shared";
import { ReconnectingSocket, wsUrl } from "../api/ws";

interface Line {
  stream: "out" | "err";
  text: string;
}

export function LogPanel({ projectId }: { projectId: string }) {
  const [lines, setLines] = useState<Line[]>([]);
  const [filter, setFilter] = useState("");
  const [onlyErrors, setOnlyErrors] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLines([]);
    const socket = new ReconnectingSocket<LogServerMessage, never>(wsUrl(`/ws/logs/${projectId}`));
    const unsubscribe = socket.onMessage((msg) => {
      if (msg.type === "backlog") setLines(msg.lines);
      else if (msg.type === "line") setLines((prev) => [...prev.slice(-999), msg]);
    });
    return () => {
      unsubscribe();
      socket.close();
    };
  }, [projectId]);

  const filteredLines = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return lines.filter((line) => {
      if (onlyErrors && line.stream !== "err") return false;
      if (needle && !line.text.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [lines, filter, onlyErrors]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [filteredLines]);

  return (
    <div className="log-panel-wrapper">
      <div className="log-filter-bar">
        <input
          type="text"
          placeholder="Logs durchsuchen…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <label className="log-filter-toggle">
          <input type="checkbox" checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} />
          Nur Fehler
        </label>
      </div>
      <div className="log-panel">
        {filteredLines.length === 0 && lines.length > 0 && (
          <p className="empty-hint">Keine Log-Zeilen passen zum Filter.</p>
        )}
        {filteredLines.map((line, i) => (
          <div key={i} className={`log-line log-${line.stream}`}>
            {line.text}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
