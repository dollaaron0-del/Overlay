import type { WebSocket } from "ws";
import type { LogServerMessage } from "@overlay/shared";
import { getProject } from "../projects/projects.registry.js";
import { getBacklog, subscribeToLogs } from "./pm2.logbus.js";
import { getBacklog as getSystemdBacklog, subscribeToLogs as subscribeToSystemdLogs } from "../systemd/systemd.logbus.js";
import { getBacklog as getPm2RootBacklog, subscribeToLogs as subscribeToPm2RootLogs } from "../pm2root/pm2root.logbus.js";

export async function handleLogsConnection(ws: WebSocket, projectId: string): Promise<void> {
  const project = await getProject(projectId);
  if (!project) {
    ws.close(4404, "project_not_found");
    return;
  }

  const send = (msg: LogServerMessage) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };

  if (project.kind === "systemd") {
    const backlog = await getSystemdBacklog(project.systemdUnit!);
    send({ type: "backlog", lines: backlog });
    const unsubscribe = await subscribeToSystemdLogs(project.systemdUnit!, (line) => send({ type: "line", ...line }));
    ws.on("close", () => unsubscribe());
    return;
  }

  if (project.kind === "pm2-root") {
    const backlog = await getPm2RootBacklog(project.pm2RootName!);
    send({ type: "backlog", lines: backlog });
    const unsubscribe = subscribeToPm2RootLogs(project.pm2RootName!, (line) => send({ type: "line", ...line }));
    ws.on("close", () => unsubscribe());
    return;
  }

  const backlog = await getBacklog(project.pm2Name!);
  send({ type: "backlog", lines: backlog });

  const unsubscribe = await subscribeToLogs(project.pm2Name!, (line) => send({ type: "line", ...line }));

  ws.on("close", () => unsubscribe());
}
