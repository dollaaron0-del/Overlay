import type { WebSocket } from "ws";
import type { DeployServerMessage } from "@overlay/shared";
import { getDeployBacklog, subscribeToDeployMessages } from "./deploy-log-bus.js";

/**
 * Always stays subscribed regardless of whether a deploy happens to be
 * running yet — the frontend only ever opens this connection right before
 * triggering a deploy, so "not running" here just means "nothing to show
 * yet", not "give up": moments later the deploy starts and lines arrive
 * live.
 *
 * The backlog is only replayed while a run is still `running`: this covers
 * a client that connects a moment after the deploy already started (so it
 * still sees the lines from the beginning), without replaying a *previous,
 * already-finished* run's transcript ahead of the new one — the frontend
 * always triggers a fresh deploy right after connecting, so a finished
 * run's backlog here is always stale relative to what's about to start.
 */
export function handleDeployConnection(ws: WebSocket, projectId: string): void {
  const send = (msg: DeployServerMessage) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };

  const { running, lines } = getDeployBacklog(projectId);
  if (running) {
    for (const line of lines) send(line);
  } else {
    send({ type: "not_running" });
  }

  const unsubscribe = subscribeToDeployMessages(projectId, send);
  ws.on("close", () => unsubscribe());
}
