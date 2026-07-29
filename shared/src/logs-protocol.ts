// Message envelope for /ws/logs/:projectId

export type LogServerMessage =
  | { type: "line"; stream: "out" | "err"; text: string }
  | { type: "backlog"; lines: Array<{ stream: "out" | "err"; text: string }> };

// Message envelope for /ws/deploy/:projectId — live output of a deploy
// script already in progress (or a no-op if none is running).
export type DeployServerMessage =
  | { type: "line"; stream: "out" | "err"; text: string }
  | { type: "exit"; success: boolean; exitCode: number | null }
  | { type: "not_running" };
