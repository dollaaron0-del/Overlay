import type { WebSocket } from "ws";
import type { LogServerMessage } from "@overlay/shared";
import { getProject } from "../projects/projects.registry.js";
import { getBacklog, subscribeToLogs } from "./pm2.logbus.js";

export async function handleLogsConnection(ws: WebSocket, projectId: string): Promise<void> {
  const project = await getProject(projectId);
  if (!project) {
    ws.close(4404, "project_not_found");
    return;
  }

  const send = (msg: LogServerMessage) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };

  const backlog = await getBacklog(project.pm2Name);
  send({ type: "backlog", lines: backlog });

  const unsubscribe = await subscribeToLogs(project.pm2Name, (line) => send({ type: "line", ...line }));

  ws.on("close", () => unsubscribe());
}
