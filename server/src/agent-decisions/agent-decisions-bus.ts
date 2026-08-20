import { EventEmitter } from "node:events";
import type { AgentDecision } from "@overlay/shared";

// In-process pub/sub so every open /ws/agent-decisions/:projectId connection
// sees new decisions live — same pattern as emmy-bus.ts.
const emitter = new EventEmitter();
emitter.setMaxListeners(0);
const DECISION_CHANNEL = "decision";

export function publishAgentDecision(decision: AgentDecision): void {
  emitter.emit(DECISION_CHANNEL, decision);
}

export function subscribeToAgentDecisions(onDecision: (decision: AgentDecision) => void): () => void {
  emitter.on(DECISION_CHANNEL, onDecision);
  return () => emitter.off(DECISION_CHANNEL, onDecision);
}
