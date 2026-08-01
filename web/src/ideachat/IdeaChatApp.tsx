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

type AnswerSource = "ollama-ram" | "ollama-gpu" | "claude";

interface ChatAttachment {
  filename: string;
  originalName: string;
  mimeType: string;
  kind: "image" | "document";
}

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  at: string;
  source?: AnswerSource;
  attachments?: ChatAttachment[];
}

const ATTACHMENT_ACCEPT = "image/jpeg,image/png,image/webp,image/heic,application/pdf,text/plain,text/markdown,.md,.doc,.docx";

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Datei konnte nicht gelesen werden"));
    reader.readAsDataURL(file);
  });
}

const SOURCE_LABEL: Record<AnswerSource, string> = {
  "ollama-ram": "🖥️ RAM-Ollama",
  "ollama-gpu": "🎮 GPU-Ollama",
  claude: "✨ Claude",
};

interface ChatDetail extends ChatSummary {
  claudeSessionId: string | null;
  messages: ChatMessage[];
}

interface AiTierStatus {
  id: AnswerSource;
  label: string;
  role: string;
  configured: boolean;
  reachable?: boolean;
  model?: string;
  modelInstalled?: boolean;
  error?: string;
}

type View = { mode: "list" } | { mode: "new" } | { mode: "chat"; chatId: string };

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
}

function tierState(tier: AiTierStatus): { className: string; text: string } {
  if (!tier.configured) return { className: "skipped", text: "Nicht konfiguriert — wird übersprungen" };
  if (!tier.reachable) return { className: "error", text: `Nicht erreichbar${tier.error ? ` (${tier.error})` : ""}` };
  if (tier.modelInstalled === false) return { className: "warn", text: `Erreichbar, Modell "${tier.model}" nicht installiert` };
  return { className: "ok", text: tier.model ? `Bereit (${tier.model})` : "Bereit" };
}

function AiCascadeStatus({ tiers }: { tiers: AiTierStatus[] | null }) {
  return (
    <div className="ideachat-ai-status">
      <h3>KI-Kaskade</h3>
      {tiers === null ? (
        <p className="empty-hint">Lädt…</p>
      ) : (
        <ol className="ideachat-ai-status-list">
          {tiers.map((tier) => {
            const state = tierState(tier);
            return (
              <li key={tier.id} className={`ideachat-ai-tier ideachat-ai-tier-${state.className}`}>
                <span className="ideachat-ai-tier-dot" />
                <div className="ideachat-ai-tier-body">
                  <div className="ideachat-ai-tier-label">{tier.label}</div>
                  <div className="ideachat-ai-tier-role">{tier.role}</div>
                  <div className="ideachat-ai-tier-state">{state.text}</div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
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
  const [aiStatus, setAiStatus] = useState<AiTierStatus[] | null>(null);
  const [attaching, setAttaching] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadChats = () => {
    api
      .get<ChatSummary[]>("/api/idea-chats")
      .then(setChats)
      .catch(() => setChats([]));
  };

  useEffect(() => {
    loadChats();
    api
      .get<AiTierStatus[]>("/api/idea-chats/ai-status")
      .then(setAiStatus)
      .catch(() => setAiStatus([]));
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

  const sendAttachments = async (fileList: FileList) => {
    if (view.mode !== "chat" || fileList.length === 0) return;
    const chatId = view.chatId;
    setAttaching(true);
    setError(null);
    const messageText = draft.trim() || undefined;
    setDraft("");
    try {
      const attachments = await Promise.all(
        Array.from(fileList).map(async (file) => ({
          dataBase64: await readFileAsBase64(file),
          mimeType: file.type,
          originalName: file.name,
        })),
      );
      const chat = await api.post<ChatDetail>(`/api/idea-chats/${chatId}/attachments`, {
        message: messageText,
        attachments,
      });
      setActiveChat(chat);
      loadChats();
    } catch (err) {
      setError(err instanceof ApiError ? (err.message ?? "Fehler beim Anhängen") : "Fehler beim Anhängen");
    } finally {
      setAttaching(false);
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
        <AiCascadeStatus tiers={aiStatus} />
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
        {sending && <p className="empty-hint">Denkt nach…</p>}
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
                {m.source && <span className="ideachat-message-source">{SOURCE_LABEL[m.source]}</span>}
                <p>{m.text}</p>
                {m.attachments && m.attachments.length > 0 && (
                  <div className="ideachat-attachments">
                    {m.attachments.map((a) => {
                      const url = `/api/idea-chats/${activeChat.id}/attachments/${a.filename}`;
                      return a.kind === "image" ? (
                        <a key={a.filename} href={url} target="_blank" rel="noreferrer" className="ideachat-attachment-image">
                          <img src={url} alt={a.originalName} />
                        </a>
                      ) : (
                        <a key={a.filename} href={url} target="_blank" rel="noreferrer" className="ideachat-attachment-doc">
                          📄 {a.originalName}
                        </a>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
            {sending && (
              <div className="ideachat-message ideachat-message-assistant ideachat-message-pending">
                <p>Denkt nach…</p>
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
          {attaching && <p className="empty-hint">Lädt Anhang hoch…</p>}

          <div className="ideachat-input-row">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ATTACHMENT_ACCEPT}
              className="ideachat-file-input"
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) sendAttachments(e.target.files);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              className="ideachat-attach-button"
              onClick={() => fileInputRef.current?.click()}
              disabled={sending || attaching}
              title="Dokument oder Foto anhängen"
            >
              📎
            </button>
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
