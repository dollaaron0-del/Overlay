import { useEffect, useRef, useState } from "react";
import type { ProjectSummary, StatusServerMessage } from "@overlay/shared";
import { ReconnectingSocket, wsUrl } from "../api/ws";

export function useProjectsStatus(): ProjectSummary[] {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const socketRef = useRef<ReconnectingSocket<StatusServerMessage, never> | null>(null);

  useEffect(() => {
    const socket = new ReconnectingSocket<StatusServerMessage, never>(wsUrl("/ws/status"));
    socketRef.current = socket;
    const unsubscribe = socket.onMessage((msg) => {
      if (msg.type === "projects") setProjects(msg.projects);
    });
    return () => {
      unsubscribe();
      socket.close();
    };
  }, []);

  return projects;
}
