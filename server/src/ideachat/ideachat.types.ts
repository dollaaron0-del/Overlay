/** Which tier actually produced an assistant reply — see tiered-answer.ts. */
export type AnswerSource = "ollama-ram" | "ollama-gpu" | "claude";

export interface IdeaChatAttachment {
  /** Sanitized on-disk filename (timestamp + random suffix + extension) — never the client-supplied name. */
  filename: string;
  /** User-facing name for display only; never used to build a filesystem path. */
  originalName: string;
  mimeType: string;
  kind: "image" | "document";
}

export interface IdeaChatMessage {
  role: "user" | "assistant";
  text: string;
  at: string;
  /** Only set on assistant messages. */
  source?: AnswerSource;
  attachments?: IdeaChatAttachment[];
}

export interface IdeaChat {
  id: string;
  projectId: string;
  /** Short label for the chat list, derived from the first message. */
  title: string;
  /** claude CLI session id to --resume; null until the first reply comes back. */
  claudeSessionId: string | null;
  messages: IdeaChatMessage[];
  createdAt: string;
  updatedAt: string;
}
