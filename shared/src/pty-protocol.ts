// Message envelope for /ws/pty/:projectId

export type PtyClientMessage =
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "pong" };

export type PtyServerMessage =
  | { type: "data"; chunk: string }
  | { type: "exit"; code: number | null }
  | { type: "ping" };
