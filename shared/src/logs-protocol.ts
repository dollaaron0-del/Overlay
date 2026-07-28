// Message envelope for /ws/logs/:projectId

export type LogServerMessage =
  | { type: "line"; stream: "out" | "err"; text: string }
  | { type: "backlog"; lines: Array<{ stream: "out" | "err"; text: string }> };
