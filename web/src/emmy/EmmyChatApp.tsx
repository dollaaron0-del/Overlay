import { useEffect, useMemo, useRef, useState } from "react";
import type { EmmyChat, EmmyMessage, EmmyServerMessage, EmmyTaskStatus } from "@overlay/shared";
import { api, ApiError } from "../api/client";
import { ReconnectingSocket, wsUrl } from "../api/ws";
import { formatTimestamp } from "../format";

const STATUS_LABEL: Record<EmmyTaskStatus, string> = {
  open: "Offen",
  in_progress: "In Arbeit",
  done: "Erledigt",
};
const STATUS_ORDER: EmmyTaskStatus[] = ["in_progress", "open", "done"];

interface PendingAttachment {
  dataBase64: string;
  mimeType: string;
  originalName: string;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function EmmyChatApp() {
  const [chats, setChats] = useState<EmmyChat[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messagesByChat, setMessagesByChat] = useState<Record<string, EmmyMessage[]>>({});
  const [loadedChats, setLoadedChats] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Live chat list + incoming messages over one socket.
  useEffect(() => {
    const socket = new ReconnectingSocket<EmmyServerMessage, never>(wsUrl("/ws/emmy"));
    const unsubscribe = socket.onMessage((msg) => {
      if (msg.type === "chats") {
        setChats(msg.chats);
      } else if (msg.type === "message") {
        const m = msg.message;
        setMessagesByChat((prev) => {
          const existing = prev[m.chatId] ?? [];
          if (existing.some((x) => x.id === m.id)) return prev;
          return { ...prev, [m.chatId]: [...existing, m] };
        });
      }
    });
    return () => {
      unsubscribe();
      socket.close();
    };
  }, []);

  // Initial chat list (in case the socket is slow) + auto-select the general chat.
  useEffect(() => {
    api
      .get<EmmyChat[]>("/api/emmy/chats")
      .then((list) => {
        setChats(list);
        setSelectedId((cur) => cur ?? list[0]?.id ?? null);
      })
      .catch(() => {});
  }, []);

  // Lazy-load a chat's messages the first time it's opened.
  useEffect(() => {
    if (!selectedId || loadedChats.has(selectedId)) return;
    const id = selectedId;
    api
      .get<EmmyMessage[]>(`/api/emmy/chats/${id}/messages`)
      .then((msgs) => {
        setMessagesByChat((prev) => ({ ...prev, [id]: msgs }));
        setLoadedChats((prev) => new Set(prev).add(id));
      })
      .catch(() => {});
  }, [selectedId, loadedChats]);

  const selectedChat = chats.find((c) => c.id === selectedId) ?? null;
  const messages = selectedId ? (messagesByChat[selectedId] ?? []) : [];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, selectedId]);

  const taskChats = useMemo(() => chats.filter((c) => c.kind === "task"), [chats]);
  const generalChat = chats.find((c) => c.kind === "general") ?? null;

  const addFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);
    try {
      const next: PendingAttachment[] = [];
      for (const file of Array.from(files)) {
        next.push({
          dataBase64: await fileToBase64(file),
          mimeType: file.type || "application/octet-stream",
          originalName: file.name,
        });
      }
      setPending((prev) => [...prev, ...next].slice(0, 10));
    } catch {
      setError("Datei konnte nicht gelesen werden.");
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const sendMessage = async () => {
    if (!selectedId) return;
    const text = draft.trim();
    if (!text && pending.length === 0) return;
    setDraft("");
    const attachments = pending;
    setPending([]);
    setSending(true);
    setError(null);
    try {
      await api.post(`/api/emmy/chats/${selectedId}/messages`, {
        text: text || undefined,
        attachments: attachments.length > 0 ? attachments : undefined,
      });
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `Gespeichert, aber nicht an Emmy gesendet (${err.message}).`
          : "Gespeichert, aber nicht an Emmy gesendet.",
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

  const createTask = async () => {
    const title = newTaskTitle.trim();
    setNewTaskTitle("");
    try {
      const chat = await api.post<EmmyChat>("/api/emmy/chats", { kind: "task", title: title || undefined });
      setSelectedId(chat.id);
    } catch {
      setError("Aufgabe konnte nicht angelegt werden.");
    }
  };

  const setStatus = async (id: string, status: EmmyTaskStatus) => {
    try {
      await api.patch(`/api/emmy/chats/${id}`, { status });
    } catch {
      setError("Status konnte nicht geändert werden.");
    }
  };

  const renameChat = async (id: string, title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    try {
      await api.patch(`/api/emmy/chats/${id}`, { title: trimmed });
    } catch {
      setError("Umbenennen fehlgeschlagen.");
    }
  };

  const removeChat = async (id: string) => {
    if (!window.confirm("Diese Aufgabe samt Chatverlauf löschen?")) return;
    try {
      await api.delete(`/api/emmy/chats/${id}`);
      setSelectedId(generalChat?.id ?? null);
    } catch {
      setError("Löschen fehlgeschlagen.");
    }
  };

  return (
    <div className="emmy2-app" data-view={selectedId ? "chat" : "list"}>
      <aside className="emmy2-sidebar">
        <div className="emmy2-sidebar-head">
          <div className="emmy2-avatar">🦊</div>
          <h2>Emmy</h2>
        </div>

        {generalChat && (
          <button
            className={`emmy2-chat-row${selectedId === generalChat.id ? " active" : ""}`}
            onClick={() => setSelectedId(generalChat.id)}
          >
            <span className="emmy2-chat-title">💬 {generalChat.title}</span>
          </button>
        )}

        <div className="emmy2-new-task">
          <input
            value={newTaskTitle}
            onChange={(e) => setNewTaskTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void createTask()}
            placeholder="Neue Aufgabe…"
          />
          <button onClick={() => void createTask()} title="Aufgabe anlegen">
            ＋
          </button>
        </div>

        {STATUS_ORDER.map((status) => {
          const group = taskChats.filter((c) => c.status === status);
          if (group.length === 0) return null;
          return (
            <div key={status} className="emmy2-group">
              <div className="emmy2-group-head">
                {STATUS_LABEL[status]} <span className="emmy2-group-count">{group.length}</span>
              </div>
              {group.map((c) => (
                <button
                  key={c.id}
                  className={`emmy2-chat-row${selectedId === c.id ? " active" : ""}`}
                  onClick={() => setSelectedId(c.id)}
                >
                  <span className="emmy2-chat-title">{c.title}</span>
                  <span className={`emmy2-status-dot emmy2-status-${c.status}`} />
                </button>
              ))}
            </div>
          );
        })}
      </aside>

      <section className="emmy2-main">
        {!selectedChat ? (
          <p className="empty-hint">Wähle links einen Chat oder leg eine Aufgabe an.</p>
        ) : (
          <>
            <header className="emmy2-conv-head">
              <button className="emmy2-back" onClick={() => setSelectedId(null)} title="Zurück">
                ‹
              </button>
              <ChatTitle chat={selectedChat} onRename={renameChat} />
              {selectedChat.kind === "task" && (
                <div className="emmy2-conv-actions">
                  <select
                    value={selectedChat.status}
                    onChange={(e) => void setStatus(selectedChat.id, e.target.value as EmmyTaskStatus)}
                  >
                    {STATUS_ORDER.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABEL[s]}
                      </option>
                    ))}
                  </select>
                  <button className="emmy2-delete" onClick={() => void removeChat(selectedChat.id)} title="Löschen">
                    🗑
                  </button>
                </div>
              )}
            </header>

            <div className="emmy2-messages">
              {messages.length === 0 && <p className="empty-hint">Noch keine Nachrichten.</p>}
              {messages.map((m) => (
                <MessageBubble key={m.id} message={m} />
              ))}
              <div ref={messagesEndRef} />
            </div>

            {error && <p className="emmy2-error">{error}</p>}

            {pending.length > 0 && (
              <div className="emmy2-pending">
                {pending.map((p, i) => (
                  <span key={i} className="emmy2-pending-chip">
                    📎 {p.originalName}
                    <button onClick={() => setPending((prev) => prev.filter((_, j) => j !== i))}>×</button>
                  </span>
                ))}
              </div>
            )}

            <div className="emmy2-input-row">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                hidden
                onChange={(e) => void addFiles(e.target.files)}
              />
              <button className="emmy2-attach" onClick={() => fileInputRef.current?.click()} title="Datei anhängen">
                📎
              </button>
              <textarea
                className="emmy2-textarea"
                rows={1}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Nachricht an Emmy…"
              />
              <button
                className="emmy2-send"
                onClick={() => void sendMessage()}
                disabled={sending || (!draft.trim() && pending.length === 0)}
              >
                Senden
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function ChatTitle({ chat, onRename }: { chat: EmmyChat; onRename: (id: string, title: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(chat.title);
  useEffect(() => setValue(chat.title), [chat.title]);

  if (chat.kind === "general") return <h3 className="emmy2-conv-title">{chat.title}</h3>;

  if (editing) {
    return (
      <input
        className="emmy2-title-edit"
        value={value}
        autoFocus
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          setEditing(false);
          onRename(chat.id, value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            setEditing(false);
            onRename(chat.id, value);
          }
        }}
      />
    );
  }
  return (
    <h3 className="emmy2-conv-title" onClick={() => setEditing(true)} title="Zum Umbenennen tippen">
      {chat.title}
    </h3>
  );
}

function MessageBubble({ message }: { message: EmmyMessage }) {
  return (
    <div className={`emmy2-bubble emmy2-bubble-${message.role}`}>
      {message.text && <p>{message.text}</p>}
      {message.attachments?.map((a) => {
        const url = `/api/emmy/chats/${message.chatId}/attachments/${a.filename}`;
        return a.kind === "image" ? (
          <a key={a.filename} href={url} target="_blank" rel="noreferrer" className="emmy2-att-image">
            <img src={url} alt={a.originalName} />
          </a>
        ) : (
          <a key={a.filename} href={url} target="_blank" rel="noreferrer" className="emmy2-att-doc">
            📄 {a.originalName}
          </a>
        );
      })}
      <span className="emmy2-bubble-time">{formatTimestamp(message.at)}</span>
    </div>
  );
}
