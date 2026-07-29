import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api/client";

interface ProjectOption {
  id: string;
  dirName: string;
}

interface ChatSummary {
  id: string;
  projectId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  at: string;
}

interface ChatDetail extends ChatSummary {
  claudeSessionId: string | null;
  messages: ChatMessage[];
}

type View = { mode: "list" } | { mode: "new" } | { mode: "chat"; chatId: string };

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
}

export function IdeaChatApp() {
  const [view, setView] = useState<View>({ mode: "list" });
  const [chats, setChats] = useState<ChatSummary[] | null>(null);
  const [projects, setProjects] = useState<ProjectOption[] | null>(null);
  const [activeChat, setActiveChat] = useState<ChatDetail | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [planSaved, setPlanSaved] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const loadChats = () => {
    api
      .get<ChatSummary[]>("/api/idea-chats")
      .then(setChats)
      .catch(() => setChats([]));
  };

  useEffect(() => {
    loadChats();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeChat?.messages.length]);

  const openNewChat = () => {
    setError(null);
    setPlanSaved(null);
    setDraft("");
    if (projects === null) {
      api
        .get<ProjectOption[]>("/api/projects")
        .then(setProjects)
        .catch(() => setProjects([]));
    }
    setView({ mode: "new" });
  };

  const openChat = async (chatId: string) => {
    setError(null);
    setPlanSaved(null);
    setActiveChat(null);
    setView({ mode: "chat", chatId });
    try {
      const chat = await api.get<ChatDetail>(`/api/idea-chats/${chatId}`);
      setActiveChat(chat);
    } catch {
      setError("Konnte den Chat nicht laden.");
    }
  };

  const startChat = async (projectId: string) => {
    if (!draft.trim()) return;
    setSending(true);
    setError(null);
    try {
      const chat = await api.post<ChatDetail>("/api/idea-chats", { projectId, message: draft.trim() });
      setDraft("");
      setActiveChat(chat);
      setView({ mode: "chat", chatId: chat.id });
      loadChats();
    } catch (err) {
      setError(err instanceof ApiError ? (err.message ?? "Fehler beim Starten des Chats") : "Fehler beim Starten des Chats");
    } finally {
      setSending(false);
    }
  };

  const sendMessage = async () => {
    if (!draft.trim() || view.mode !== "chat") return;
    const chatId = view.chatId;
    setSending(true);
    setError(null);
    const messageText = draft.trim();
    setDraft("");
    try {
      const chat = await api.post<ChatDetail>(`/api/idea-chats/${chatId}/messages`, { message: messageText });
      setActiveChat(chat);
      loadChats();
    } catch (err) {
      setDraft(messageText);
      setError(err instanceof ApiError ? (err.message ?? "Fehler beim Senden") : "Fehler beim Senden");
    } finally {
      setSending(false);
    }
  };

  const savePlan = async () => {
    if (view.mode !== "chat") return;
    setError(null);
    setPlanSaved(null);
    try {
      const res = await api.post<{ relativePath: string }>(`/api/idea-chats/${view.chatId}/save-plan`, {});
      setPlanSaved(res.relativePath);
    } catch (err) {
      setError(err instanceof ApiError ? (err.message ?? "Fehler beim Speichern des Plans") : "Fehler beim Speichern des Plans");
    }
  };

  const backToList = () => {
    setView({ mode: "list" });
    setActiveChat(null);
    setError(null);
    setPlanSaved(null);
    loadChats();
  };

  if (view.mode === "list") {
    return (
      <div className="ideachat-app">
        <div className="ideachat-header">
          <h2>Ideen</h2>
          <button className="ideachat-new-button" onClick={openNewChat}>
            + Neue Idee
          </button>
        </div>
        {chats === null ? (
          <p className="empty-hint">Lädt…</p>
        ) : chats.length === 0 ? (
          <p className="empty-hint">Noch keine Ideen besprochen. Starte mit "+ Neue Idee".</p>
        ) : (
          <div className="ideachat-list">
            {chats.map((chat) => (
              <button key={chat.id} className="ideachat-list-item" onClick={() => openChat(chat.id)}>
                <span className="ideachat-list-item-title">{chat.title}</span>
                <span className="ideachat-list-item-meta">{formatDate(chat.updatedAt)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (view.mode === "new") {
    return (
      <div className="ideachat-app">
        <div className="ideachat-header">
          <button className="ideachat-back-button" onClick={backToList}>
            ← Zurück
          </button>
          <h2>Neue Idee</h2>
        </div>
        <textarea
          className="ideachat-textarea"
          placeholder="Woran denkst du gerade? Beschreib deine Idee..."
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          autoFocus
          rows={5}
        />
        <p className="settings-hint">Für welches Projekt gilt diese Idee?</p>
        {projects === null ? (
          <p className="empty-hint">Lädt…</p>
        ) : projects.length === 0 ? (
          <p className="empty-hint">Noch keine Projekte registriert.</p>
        ) : (
          <div className="ideachat-project-picker">
            {projects.map((p) => (
              <button key={p.id} disabled={sending || !draft.trim()} onClick={() => startChat(p.id)}>
                {p.dirName}
              </button>
            ))}
          </div>
        )}
        {sending && <p className="empty-hint">Claude denkt nach…</p>}
        {error && <p className="login-error">{error}</p>}
      </div>
    );
  }

  return (
    <div className="ideachat-app ideachat-chat-view">
      <div className="ideachat-header">
        <button className="ideachat-back-button" onClick={backToList}>
          ← Zurück
        </button>
        <h2>{activeChat?.title ?? "Ideen"}</h2>
      </div>

      {activeChat === null ? (
        <p className="empty-hint">Lädt…</p>
      ) : (
        <>
          <div className="ideachat-messages">
            {activeChat.messages.map((m, i) => (
              <div key={i} className={`ideachat-message ideachat-message-${m.role}`}>
                <p>{m.text}</p>
              </div>
            ))}
            {sending && (
              <div className="ideachat-message ideachat-message-assistant ideachat-message-pending">
                <p>Claude denkt nach…</p>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {activeChat.messages.some((m) => m.role === "assistant") && (
            <button className="ideachat-save-plan-button" onClick={savePlan} disabled={sending}>
              📋 Letzte Antwort als Plan speichern
            </button>
          )}
          {planSaved && <p className="overview-ollama-ok">Plan gespeichert: {planSaved}</p>}
          {error && <p className="login-error">{error}</p>}

          <div className="ideachat-input-row">
            <textarea
              className="ideachat-textarea"
              placeholder="Antworten oder weiter ausarbeiten…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={2}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
            />
            <button className="ideachat-send-button" onClick={sendMessage} disabled={sending || !draft.trim()}>
              {sending ? "…" : "Senden"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
