// Message envelope for /ws/emmy (live-push the single Emmy/OpenClaw conversation)

export interface EmmyMessage {
  id: string;
  role: "me" | "emmy";
  text: string;
  at: string;
}

export type EmmyServerMessage =
  | { type: "history"; messages: EmmyMessage[] }
  | { type: "message"; message: EmmyMessage };
