// Message + chat envelopes for the Emmy multi-chat app.
//
// The app is modelled on the Claude app: one always-present general chat plus
// any number of task chats, each of which maps to its own isolated OpenClaw
// session (sessionKey "agent:main:overlay:<chatId>") so Emmy keeps separate
// context per task. Replies come back in via /api/emmy/inbound tagged with
// the originating chatId (see emmy-inbound.routes.ts).

/**
 * Above this length an Emmy reply is treated as a long report rather than a
 * normal chat message: the web UI caps its inline preview and offers a full
 * reader, and the server generates a PDF version of it as a real attachment
 * (see emmy-pdf.ts) so the full text is never trapped in a clipped preview.
 * A reply flagged isFinalDocument always counts as a long report regardless
 * of its length.
 */
export const EMMY_LONG_REPORT_CHARS = 1200;

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

/**
 * Only meaningful for `category === "research"`:
 * - "deep_research" (or absent) — she hasn't sent her first full answer yet;
 *   she is still digging in, potentially for hours.
 * - "discussion" — her first answer landed. From here she answers from what
 *   she already gathered, doing only short targeted follow-up research when a
 *   question goes somewhere thin, until the final document is requested.
 */
export type EmmyResearchPhase = "deep_research" | "discussion";

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
  /** Marks the one reply that is the requested end-of-conversation research document. */
  isFinalDocument?: boolean;
  /** Marks a reply where Emmy is asking Aaron to clarify a vague research task instead of diving in. */
  needsClarification?: boolean;
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
  /** ISO timestamp of the last automatic recurring check. Only meaningful for category "recurring"; absent means it has never run. */
  lastRecurringCheckAt?: string;
  /** Running count of sources Emmy has searched for this task, self-reported via /api/emmy/inbound. */
  sourcesSearched?: number;
  /** Emmy's own 0-100 estimate of how well she now knows the topic, self-reported via /api/emmy/inbound. */
  knowledgeLevel?: number;
  /** Research-only: where in the research → discussion flow this chat currently is. */
  researchPhase?: EmmyResearchPhase;
  /** Set when Aaron asked for the final document; consumed by the next reply, which gets tagged isFinalDocument. */
  pendingFinalDocument?: boolean;
  /** ISO timestamp of the automatic "dueAt reached, what's your status?" nudge (see emmy-scheduler.ts). Set once so the check fires only once per research task, not on every scheduler tick. */
  dueCheckSentAt?: string;
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
/**
 * A free-floating reference window on the home screen. Emmy fills it with a
 * compiled dossier on a topic; the user drags/resizes it like a browser
 * window and keeps chatting underneath. Persisted so it survives reloads;
 * `minimized` hides the window but keeps it listed in the sidebar.
 */
export interface EmmyTopicWindow {
  id: string;
  title: string;
  content: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minimized: boolean;
  createdAt: string;
  updatedAt: string;
}

export type EmmyTopicWindowPatch = Partial<
  Pick<EmmyTopicWindow, "title" | "content" | "x" | "y" | "w" | "h" | "minimized">
>;

export type EmmyServerMessage =
  | { type: "chats"; chats: EmmyChat[] }
  | { type: "message"; message: EmmyMessage }
  | { type: "activity"; activities: EmmyActivity[] }
  | { type: "topic-windows"; topicWindows: EmmyTopicWindow[] };
