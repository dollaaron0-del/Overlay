import type { WebSocket } from "ws";
import type { EmmyServerMessage } from "@overlay/shared";
import { listChats } from "./emmy-store.js";
import { subscribeToEmmyMessages, subscribeToEmmyChats, subscribeToEmmyActivity } from "./emmy-bus.js";
import { listActivities } from "./emmy-activity.js";

/**
 * On connect, pushes the current chat list and what Emmy is busy with (the
 * client fetches per-chat messages over REST when a chat is opened). Then
 * streams new messages, chat-list changes and activity changes live — same
 * "backlog then live" shape as deploy.ws.ts.
 */
export function handleEmmyConnection(ws: WebSocket): void {
  const send = (msg: EmmyServerMessage) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };

  void listChats().then((chats) => send({ type: "chats", chats }));
  send({ type: "activity", activities: listActivities() });

  const unsubMessages = subscribeToEmmyMessages((message) => send({ type: "message", message }));
  const unsubChats = subscribeToEmmyChats((chats) => send({ type: "chats", chats }));
  const unsubActivity = subscribeToEmmyActivity((activities) => send({ type: "activity", activities }));
  ws.on("close", () => {
    unsubMessages();
    unsubChats();
    unsubActivity();
  });
}
