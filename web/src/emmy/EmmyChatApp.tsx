import { useEffect, useRef, useState } from "react";
import type { EmmyMessage, EmmyServerMessage } from "@overlay/shared";
import { api, ApiError } from "../api/client";
import { ReconnectingSocket, wsUrl } from "../api/ws";
import { formatTimestamp } from "../format";

export function EmmyChatApp() {
  const [messages, setMessages] = useState<EmmyMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Read-only over the socket (history + live pushes) — sending goes out via
  // the plain REST POST below, same split LogPanel.tsx uses for its
  // ReconnectingSocket<_, never>. The "me" message the socket echoes back
  // (emmy.routes.ts publishes to the bus before it even tries to send to
  // OpenClaw) is what actually adds it to the list, not the POST response —
  // that way a second open tab/device sees it too, not just this one.
  useEffect(() => {
    const socket = new ReconnectingSocket<EmmyServerMessage, never>(wsUrl("/ws/emmy"));
    const unsubscribe = socket.onMessage((msg) => {
      if (msg.type === "history") setMessages(msg.messages);
      else if (msg.type === "message") setMessages((prev) => [...prev, msg.message]);
    });
    return () => {
      unsubscribe();
      socket.close();
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const sendMessage = async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    setSending(true);
    setError(null);
    try {
      await api.post("/api/emmy/messages", { text });
    } catch (err) {
      // The message is saved and already visible (via the WS echo above)
      // even when this fails — only the "did it reach OpenClaw" part failed.
      setError(
        err instanceof ApiError
          ? `Gespeichert, aber nicht an OpenClaw gesendet (${err.message}).`
          : "Gespeichert, aber nicht an OpenClaw gesendet.",
      );
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  };

  return (
    <div className="emmy-app">
      <div className="emmy-header">
        <div className="emmy-avatar">E</div>
        <div className="emmy-header-text">
          <h2>Emmy</h2>
          <span className="emmy-header-sub">über OpenClaw</span>
        </div>
      </div>

      <div className="emmy-messages">
        {messages.length === 0 && <p className="empty-hint">Noch keine Nachrichten. Schreib Emmy etwas.</p>}
        {messages.map((m) => (
          <div key={m.id} className={`emmy-bubble emmy-bubble-${m.role}`}>
            <p>{m.text}</p>
            <span className="emmy-bubble-time">{formatTimestamp(m.at)}</span>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {error && <p className="emmy-error">{error}</p>}

      <div className="emmy-input-row">
        <textarea
          className="emmy-textarea"
          rows={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Nachricht an Emmy…"
        />
        <button className="emmy-send-button" onClick={() => void sendMessage()} disabled={sending || !draft.trim()}>
          Senden
        </button>
      </div>
    </div>
  );
}
