import type { WebSocket } from "ws";
import type { AgentDecisionServerMessage } from "@overlay/shared";
import { listDecisions } from "./agent-decisions-store.js";
import { subscribeToAgentDecisions } from "./agent-decisions-bus.js";

/**
 * On connect, pushes this project's decision backlog, then streams new
 * decisions for the same project live — same "backlog then live" shape as
 * emmy.ws.ts, scoped by the :projectId path segment instead of a chat id.
 */
export function handleAgentDecisionsConnection(ws: WebSocket, projectId: string): void {
  const send = (msg: AgentDecisionServerMessage) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };

  void listDecisions(projectId).then((decisions) => send({ type: "backlog", decisions }));

  const unsubscribe = subscribeToAgentDecisions((decision) => {
    if (decision.projectId === projectId) send({ type: "decision", decision });
  });
  ws.on("close", unsubscribe);
}
