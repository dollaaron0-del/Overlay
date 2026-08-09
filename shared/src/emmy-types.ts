// Message + chat envelopes for the Emmy multi-chat app.
//
// The app is modelled on the Claude app: one always-present general chat plus
// any number of task chats, each of which maps to its own isolated OpenClaw
// session (sessionKey "agent:main:overlay:<chatId>") so Emmy keeps separate
// context per task. Replies come back in via /api/emmy/inbound tagged with
// the originating chatId (see emmy-inbound.routes.ts).

export type EmmyChatKind = "general" | "task";

/** Only meaningful for task chats; general chats ignore it. */
export type EmmyTaskStatus = "open" | "in_progress" | "done";

export interface EmmyAttachment {
  /** Sanitized on-disk filename (timestamp + random suffix + extension) — never the client-supplied name. */
  filename: string;
  /** User-facing name for display only; never used to build a filesystem path. */
  originalName: string;
  mimeType: string;
  kind: "image" | "document";
}

export interface EmmyMessage {
  id: string;
  chatId: string;
  role: "me" | "emmy";
  text: string;
  at: string;
  attachments?: EmmyAttachment[];
}

export interface EmmyChat {
  id: string;
  kind: EmmyChatKind;
  title: string;
  status: EmmyTaskStatus;
  createdAt: string;
  updatedAt: string;
}

// Server -> client over the single /ws/emmy socket. The chat list is pushed
// whole on connect and whenever it changes; individual new messages stream in
// and the client routes them to the right chat by chatId.
export type EmmyServerMessage =
  | { type: "chats"; chats: EmmyChat[] }
  | { type: "message"; message: EmmyMessage };
