export interface IdeaChatMessage {
  role: "user" | "assistant";
  text: string;
  at: string;
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
