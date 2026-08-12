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

/**
 * How a task is meant to be worked on — assigned automatically when a task
 * chat is created (see emmy-categorize.ts) and correctable by hand or by Emmy:
 * - "instant"   — kurz, sofort erledigen
 * - "research"  — tiefere Recherche innerhalb eines Zeitfensters (dueAt)
 * - "recurring" — wiederkehrender Check im Intervall (intervalHours)
 */
export type EmmyCategory = "instant" | "research" | "recurring";

/** "auto" = keyword classifier or Emmy herself; "manual" = Aaron picked it, never re-guessed. */
export type EmmyCategorySource = "auto" | "manual";

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
  /** Task chats only. Absent on the general chat and on chats stored before categories existed. */
  category?: EmmyCategory;
  categorySource?: EmmyCategorySource;
  /** End of the time window for "research" tasks. */
  dueAt?: string;
  /** Check cadence for "recurring" tasks. */
  intervalHours?: number;
  /** Running count of sources Emmy has searched for this task, self-reported via /api/emmy/inbound. */
  sourcesSearched?: number;
  /** Emmy's own 0-100 estimate of how well she now knows the topic, self-reported via /api/emmy/inbound. */
  knowledgeLevel?: number;
}

/**
 * What Emmy is doing in a chat right now. Held in memory only (a restart means
 * no turn we know about is in flight), set when a turn is handed to OpenClaw
 * and cleared when the reply arrives — Emmy can also push her own progress
 * notes through /api/emmy/inbound while she works.
 */
export interface EmmyActivity {
  chatId: string;
  /** What she's working on, in her own words; falls back to a generic note. */
  note: string;
  /** When this activity started (ISO) — the UI shows how long she's been at it. */
  since: string;
  /** When the note was last refreshed (ISO); a stale note is dropped by the server. */
  updatedAt: string;
  /** Latest self-reported source count, if Emmy included one in this progress ping. */
  sourcesSearched?: number;
  /** Latest self-reported 0-100 knowledge estimate, if Emmy included one in this progress ping. */
  knowledgeLevel?: number;
}

/** A deleted conversation, kept verbatim so nothing is lost when a chat is cleared. */
export interface EmmyArchiveEntry {
  id: string;
  chat: EmmyChat;
  messages: EmmyMessage[];
  archivedAt: string;
}

/** List view of the archive — the messages themselves are fetched per entry. */
export interface EmmyArchiveSummary {
  id: string;
  chatId: string;
  title: string;
  kind: EmmyChatKind;
  category?: EmmyCategory;
  archivedAt: string;
  messageCount: number;
}

// Server -> client over the single /ws/emmy socket. The chat list and the
// activity list are pushed whole on connect and whenever they change;
// individual new messages stream in and the client routes them to the right
// chat by chatId.
export type EmmyServerMessage =
  | { type: "chats"; chats: EmmyChat[] }
  | { type: "message"; message: EmmyMessage }
  | { type: "activity"; activities: EmmyActivity[] };
