import { useEffect, useState } from "react";
import type { AgentDecision, AgentDecisionServerMessage } from "@overlay/shared";
import { ReconnectingSocket, wsUrl } from "../api/ws";

const SENTIMENT_LABEL: Record<NonNullable<AgentDecision["sentiment"]>, string> = {
  bullish: "bullish",
  neutral: "neutral",
  bearish: "bearish",
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("de-DE");
}

function DecisionCard({ decision }: { decision: AgentDecision }) {
  return (
    <details className="decision-card">
      <summary className="decision-card-summary">
        <span className="decision-card-title">{decision.title}</span>
        {decision.sentiment && <span className={`decision-sentiment decision-sentiment-${decision.sentiment}`}>{SENTIMENT_LABEL[decision.sentiment]}</span>}
        <span className="decision-card-agent">{decision.agentId}</span>
        <span className="decision-card-time">{formatTime(decision.createdAt)}</span>
      </summary>
      <div className="decision-card-body">
        <p className="decision-card-outcome">{decision.outcome}</p>
        <h4>Begründung</h4>
        <p className="decision-card-reasoning">{decision.reasoning}</p>
        {decision.sources.length > 0 && (
          <>
            <h4>Quellen</h4>
            <ul className="decision-card-sources">
              {decision.sources.map((source, i) => (
                <li key={i}>{source.url ? <a href={source.url} target="_blank" rel="noreferrer">{source.label}</a> : source.label}</li>
              ))}
            </ul>
          </>
        )}
      </div>
    </details>
  );
}

export function DecisionBoard({ projectId }: { projectId: string }) {
  const [decisions, setDecisions] = useState<AgentDecision[] | null>(null);

  useEffect(() => {
    setDecisions(null);
    const socket = new ReconnectingSocket<AgentDecisionServerMessage, never>(wsUrl(`/ws/agent-decisions/${projectId}`));
    const unsubscribe = socket.onMessage((msg) => {
      if (msg.type === "backlog") setDecisions(msg.decisions);
      else if (msg.type === "decision") setDecisions((prev) => [msg.decision, ...(prev ?? [])]);
    });
    return () => {
      unsubscribe();
      socket.close();
    };
  }, [projectId]);

  if (decisions === null) return <p className="empty-hint">Lädt…</p>;

  return (
    <div className="decision-board">
      {decisions.length === 0 ? (
        <p className="empty-hint">Noch keine Agenten-Entscheidungen für dieses Projekt.</p>
      ) : (
        decisions.map((d) => <DecisionCard key={d.id} decision={d} />)
      )}
    </div>
  );
}
