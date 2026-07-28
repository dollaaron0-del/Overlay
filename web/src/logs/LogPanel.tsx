import { useEffect, useRef, useState } from "react";
import type { LogServerMessage } from "@overlay/shared";
import { ReconnectingSocket, wsUrl } from "../api/ws";

interface Line {
  stream: "out" | "err";
  text: string;
}

export function LogPanel({ projectId }: { projectId: string }) {
  const [lines, setLines] = useState<Line[]>([]);
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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [lines]);

  return (
    <div className="log-panel">
      {lines.map((line, i) => (
        <div key={i} className={`log-line log-${line.stream}`}>
          {line.text}
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
