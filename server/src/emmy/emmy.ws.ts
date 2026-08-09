import type { WebSocket } from "ws";
import type { EmmyServerMessage } from "@overlay/shared";
import { listChats } from "./emmy-store.js";
import { subscribeToEmmyMessages, subscribeToEmmyChats } from "./emmy-bus.js";

/**
 * On connect, pushes the current chat list (the client fetches per-chat
 * messages over REST when a chat is opened). Then streams new messages and
 * chat-list changes live — same "backlog then live" shape as deploy.ws.ts.
 */
export function handleEmmyConnection(ws: WebSocket): void {
  const send = (msg: EmmyServerMessage) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };

  void listChats().then((chats) => send({ type: "chats", chats }));

  const unsubMessages = subscribeToEmmyMessages((message) => send({ type: "message", message }));
  const unsubChats = subscribeToEmmyChats((chats) => send({ type: "chats", chats }));
  ws.on("close", () => {
    unsubMessages();
    unsubChats();
  });
}
