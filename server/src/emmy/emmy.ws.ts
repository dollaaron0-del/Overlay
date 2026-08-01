import type { WebSocket } from "ws";
import type { EmmyServerMessage } from "@overlay/shared";
import { listEmmyMessages } from "./emmy-store.js";
import { subscribeToEmmyMessages } from "./emmy-bus.js";

/** Sends the full history on connect (see deploy.ws.ts for the same "backlog then live" shape), then streams new messages as they're published. */
export function handleEmmyConnection(ws: WebSocket): void {
  const send = (msg: EmmyServerMessage) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };

  void listEmmyMessages().then((messages) => send({ type: "history", messages }));

  const unsubscribe = subscribeToEmmyMessages((message) => send({ type: "message", message }));
  ws.on("close", () => unsubscribe());
}
