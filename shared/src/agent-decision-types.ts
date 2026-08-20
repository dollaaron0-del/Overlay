// Agent-Status-Board: a record of a decision an agent (Emmy, or a future
// project-specific bot) made, together with WHY — the sources it drew on and
// its reasoning — so the board can show the process, not just the outcome.
// Posted in via /api/agent-decisions/inbound (same bearer-token trust
// boundary as emmy-inbound.routes.ts) and read per-project in ProjectWorkspace.

export interface AgentDecisionSource {
  /** Human-readable label, e.g. "10-Q Q2 2026" or "Reuters: Fed hält Zinsen". */
  label: string;
  url?: string;
}

export type AgentDecisionSentiment = "bullish" | "neutral" | "bearish";

export interface AgentDecision {
  id: string;
  /** Which agent made this call, e.g. "emmy" or "aktien-bot". Free text — no registry exists yet. */
  agentId: string;
  /** Which project this decision belongs to; absent for agent-wide decisions with no single project. */
  projectId?: string;
  /** Short label for the decision, e.g. "AAPL: Position halten". */
  title: string;
  /** What was decided/done, in one or two sentences. */
  outcome: string;
  /** Why — the agent's reasoning in its own words. */
  reasoning: string;
  sources: AgentDecisionSource[];
  sentiment?: AgentDecisionSentiment;
  createdAt: string;
}

// Server -> client over /ws/agent-decisions/:projectId. The backlog for that
// project is pushed whole on connect (mirrors emmy's "chats" message); new
// decisions for that project stream in individually afterwards.
export type AgentDecisionServerMessage =
  | { type: "backlog"; decisions: AgentDecision[] }
  | { type: "decision"; decision: AgentDecision };
