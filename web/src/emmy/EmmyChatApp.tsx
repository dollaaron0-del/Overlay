import { useEffect, useMemo, useRef, useState } from "react";
import type {
  EmmyActivity,
  EmmyArchiveEntry,
  EmmyArchiveSummary,
  EmmyCategory,
  EmmyChat,
  EmmyMessage,
  EmmyServerMessage,
  EmmyTaskStatus,
} from "@overlay/shared";
import { api, ApiError } from "../api/client";
import { ReconnectingSocket, wsUrl } from "../api/ws";
import { formatTimestamp } from "../format";
import { renderMiniMarkdown } from "./miniMarkdown";
import { defaultProjectIcon } from "../os/project-icon";

/** Above this length a reply gets "open as document"/"download" actions instead of only living in the bubble. */
const LONG_REPORT_CHARS = 1200;

function downloadFilenameFor(chatTitle: string, at: string): string {
  const safeTitle = chatTitle.trim().replace(/[^\p{L}\p{N} _-]/gu, "").replace(/\s+/g, "-").slice(0, 60) || "bericht";
  return `emmy-${safeTitle}-${at.slice(0, 10)}.md`;
}

/** Client-side only: saves the raw markdown text as a .md file. No backend round-trip needed. */
function downloadAsMarkdown(text: string, filename: string): void {
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Wraps a finished research report in an instruction so the project's agent
 * implements it instead of treating it as a plain chat message — used for the
 * "In Projekt umsetzen" action on report/final-document bubbles.
 */
function buildImplementationPrompt(reportText: string, chatTitle: string): string {
  return `Setze das folgende Recherche-Ergebnis aus Emmys Chat „${chatTitle}“ in diesem Projekt um. Lies es aufmerksam durch, leite die relevanten Schritte ab und implementiere sie direkt im Code dieses Projekts.\n\n---\n\n${reportText}`;
}

const STATUS_LABEL: Record<EmmyTaskStatus, string> = {
  open: "Offen",
  in_progress: "In Arbeit",
  done: "Erledigt",
};
const STATUS_ORDER: EmmyTaskStatus[] = ["in_progress", "open", "done"];

// The three ways Aaron works with Emmy — task chats are grouped by these
// instead of by status, because the category decides how a task is handled.
const CATEGORY_LABEL: Record<EmmyCategory, string> = {
  instant: "Sofort erledigen",
  research: "Recherche im Zeitfenster",
  recurring: "Wiederkehrender Check",
};
const CATEGORY_ICON: Record<EmmyCategory, string> = {
  instant: "⚡",
  research: "🔍",
  recurring: "🔁",
};
const CATEGORY_ORDER: EmmyCategory[] = ["instant", "research", "recurring"];

/** Chats stored before categories existed have none; they read as "sofort". */
function categoryOf(chat: EmmyChat): EmmyCategory {
  return chat.category ?? "instant";
}

function formatDue(iso: string): string {
  return new Date(iso).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" });
}

function formatInterval(hours: number): string {
  if (hours < 1) return `alle ${Math.round(hours * 60)} min`;
  if (hours === 1) return "stündlich";
  if (hours === 24) return "täglich";
  if (hours === 24 * 7) return "wöchentlich";
  if (hours === 24 * 30) return "monatlich";
  if (hours % 24 === 0) return `alle ${hours / 24} Tage`;
  return `alle ${hours} h`;
}

/** "seit 3 Min." — how long Emmy has been on this one. */
function formatSince(iso: string, now: number): string {
  const minutes = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "gerade eben";
  if (minutes < 60) return `seit ${minutes} Min.`;
  return `seit ${Math.floor(minutes / 60)} Std.`;
}

/**
 * "nächster Check: in ca. 2 Std." — purely client-side, from
 * lastRecurringCheckAt (or createdAt, if it has never run yet) + intervalHours.
 * The scheduler itself decides when a check actually fires; this is only a
 * display estimate.
 */
function nextCheckLabel(chat: EmmyChat, now: number): string {
  if (!chat.intervalHours) return "";
  const last = chat.lastRecurringCheckAt ?? chat.createdAt;
  const dueAt = new Date(last).getTime() + chat.intervalHours * 3_600_000;
  const minutesLeft = Math.round((dueAt - now) / 60_000);
  if (minutesLeft <= 0) return "nächster Check: fällig";
  if (minutesLeft < 60) return `nächster Check: in ${minutesLeft} Min.`;
  const hoursLeft = Math.round(minutesLeft / 60);
  if (hoursLeft < 24) return `nächster Check: in ${hoursLeft} Std.`;
  return `nächster Check: in ${Math.round(hoursLeft / 24)} Tagen`;
}

/**
 * The live activity ping carries the freshest numbers while Emmy is working;
 * once she goes idle those same numbers live on the chat record instead
 * (persisted, so "wie gut kennt sie sich aus" survives a restart or a task
 * being finished).
 */
function progressOf(
  chat: EmmyChat,
  activity: EmmyActivity | undefined,
): { sourcesSearched?: number; knowledgeLevel?: number } {
  return {
    sourcesSearched: activity?.sourcesSearched ?? chat.sourcesSearched,
    knowledgeLevel: activity?.knowledgeLevel ?? chat.knowledgeLevel,
  };
}

/** For <input type="date">, which wants YYYY-MM-DD in local time. */
function toDateInput(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** A picked day means "by the end of that day". */
function fromDateInput(value: string): string | null {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 23, 59, 59).toISOString();
}

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

export function EmmyChatApp({ onOpenProject }: { onOpenProject?: (projectId: string) => void }) {
  const [chats, setChats] = useState<EmmyChat[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messagesByChat, setMessagesByChat] = useState<Record<string, EmmyMessage[]>>({});
  const [loadedChats, setLoadedChats] = useState<Set<string>>(new Set());
  const [activities, setActivities] = useState<EmmyActivity[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archive, setArchive] = useState<EmmyArchiveSummary[]>([]);
  const [openArchiveEntry, setOpenArchiveEntry] = useState<EmmyArchiveEntry | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [openDocument, setOpenDocument] = useState<{ message: EmmyMessage; chatTitle: string } | null>(null);
  const [projectPickerRequest, setProjectPickerRequest] = useState<{ text: string; heading: string } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectedIdRef = useRef<string | null>(null);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  // Live chat list, incoming messages and "what is Emmy doing" over one socket.
  useEffect(() => {
    const socket = new ReconnectingSocket<EmmyServerMessage, never>(wsUrl("/ws/emmy"));
    const unsubscribe = socket.onMessage((msg) => {
      if (msg.type === "chats") {
        setChats(msg.chats);
      } else if (msg.type === "activity") {
        setActivities(msg.activities);
      } else if (msg.type === "message") {
        const m = msg.message;
        setMessagesByChat((prev) => {
          const existing = prev[m.chatId] ?? [];
          if (existing.some((x) => x.id === m.id)) return prev;
          return { ...prev, [m.chatId]: [...existing, m] };
        });
      }
    });
    // Anything that lands while the socket is reconnecting (sleep, network
    // change, iOS backgrounding a research run that takes hours) is gone for
    // good otherwise — updates only ever arrive live, never replayed. That
    // includes "she went idle" / "sources found so far" broadcasts, so a
    // research run that finishes (or dies) during a reconnect gap would
    // otherwise leave the sidebar stuck showing it as still running with a
    // stale source count forever. So on every reconnect, re-fetch chats and
    // activity from REST (the server's current truth) and drop the "already
    // loaded" mark for whatever chat is open so its messages get refetched too.
    const unsubOpen = socket.onOpen(() => {
      api
        .get<EmmyChat[]>("/api/emmy/chats")
        .then(setChats)
        .catch(() => {});
      api
        .get<EmmyActivity[]>("/api/emmy/activity")
        .then(setActivities)
        .catch(() => {});
      setLoadedChats((prev) => {
        if (!selectedIdRef.current || !prev.has(selectedIdRef.current)) return prev;
        const next = new Set(prev);
        next.delete(selectedIdRef.current);
        return next;
      });
    });
    return () => {
      unsubscribe();
      unsubOpen();
      socket.close();
    };
  }, []);

  // Initial chat list + activity (in case the socket is slow) + auto-select the general chat.
  useEffect(() => {
    api
      .get<EmmyChat[]>("/api/emmy/chats")
      .then((list) => {
        setChats(list);
        setSelectedId((cur) => cur ?? list[0]?.id ?? null);
      })
      .catch(() => {});
    api
      .get<EmmyActivity[]>("/api/emmy/activity")
      .then(setActivities)
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

  // Keeps "seit …" and "nächster Check …" honest without a render loop when
  // there's nothing time-based to show.
  const hasRecurringChat = chats.some((c) => c.kind === "task" && c.category === "recurring");
  useEffect(() => {
    if (activities.length === 0 && !hasRecurringChat) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [activities, hasRecurringChat]);

  const selectedChat = chats.find((c) => c.id === selectedId) ?? null;
  const messages = selectedId ? (messagesByChat[selectedId] ?? []) : [];
  const activityByChat = useMemo(
    () => Object.fromEntries(activities.map((a) => [a.chatId, a])) as Record<string, EmmyActivity>,
    [activities],
  );
  const activeActivity = selectedId ? activityByChat[selectedId] : undefined;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, selectedId, activeActivity?.note]);

  const taskChats = useMemo(() => chats.filter((c) => c.kind === "task"), [chats]);
  const generalChat = chats.find((c) => c.kind === "general") ?? null;

  const loadArchive = async () => {
    setArchiveOpen(true);
    setSelectedId(null);
    setOpenArchiveEntry(null);
    try {
      setArchive(await api.get<EmmyArchiveSummary[]>("/api/emmy/archive"));
    } catch {
      setError("Archiv konnte nicht geladen werden.");
    }
  };

  const openChat = (id: string) => {
    setArchiveOpen(false);
    setOpenArchiveEntry(null);
    setSelectedId(id);
  };

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

  const sendMessage = async (opts?: { requestFinalDocument?: boolean }) => {
    if (!selectedId) return;
    const requestFinalDocument = opts?.requestFinalDocument === true;
    const text = draft.trim() || (requestFinalDocument ? "Bitte erstelle das Abschlussdokument." : "");
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
        requestFinalDocument: requestFinalDocument || undefined,
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
      openChat(chat.id);
    } catch {
      setError("Aufgabe konnte nicht angelegt werden.");
    }
  };

  const patchChat = async (id: string, patch: Record<string, unknown>, failure: string) => {
    try {
      await api.patch(`/api/emmy/chats/${id}`, patch);
    } catch {
      setError(failure);
    }
  };

  const renameChat = (id: string, title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    void patchChat(id, { title: trimmed }, "Umbenennen fehlgeschlagen.");
  };

  /** Deleting never destroys anything — both paths archive the history first. */
  const removeChat = async (chat: EmmyChat) => {
    const question =
      chat.kind === "general"
        ? "Allgemeinen Chat leeren? Der Verlauf bleibt im Archiv gespeichert."
        : "Diese Unterhaltung löschen? Der Verlauf bleibt im Archiv gespeichert.";
    if (!window.confirm(question)) return;
    try {
      await api.delete(`/api/emmy/chats/${chat.id}`);
      if (chat.kind === "general") {
        // The chat stays, only its history moved — drop the local copy too.
        setMessagesByChat((prev) => ({ ...prev, [chat.id]: [] }));
      } else {
        setSelectedId(generalChat?.id ?? null);
      }
      if (archiveOpen) void loadArchive();
    } catch {
      setError("Löschen fehlgeschlagen.");
    }
  };

  const purgeArchiveEntry = async (entry: EmmyArchiveSummary) => {
    if (!window.confirm(`„${entry.title}" endgültig löschen? Das ist nicht rückgängig zu machen.`)) return;
    try {
      await api.delete(`/api/emmy/archive/${entry.id}`);
      setArchive((prev) => prev.filter((e) => e.id !== entry.id));
      setOpenArchiveEntry((cur) => (cur?.id === entry.id ? null : cur));
    } catch {
      setError("Endgültiges Löschen fehlgeschlagen.");
    }
  };

  const showArchiveEntry = async (entry: EmmyArchiveSummary) => {
    try {
      setOpenArchiveEntry(await api.get<EmmyArchiveEntry>(`/api/emmy/archive/${entry.id}`));
    } catch {
      setError("Archivierte Unterhaltung konnte nicht geladen werden.");
    }
  };

  const showList = !selectedId && !archiveOpen;

  return (
    <div className="emmy2-app" data-view={showList ? "list" : "chat"}>
      <aside className="emmy2-sidebar">
        <div className="emmy2-sidebar-head">
          <div className="emmy2-avatar">🦊</div>
          <h2>Emmy</h2>
        </div>

        {generalChat && (
          <button
            className={`emmy2-chat-row${selectedId === generalChat.id ? " active" : ""}`}
            onClick={() => openChat(generalChat.id)}
          >
            <span className="emmy2-chat-title">💬 {generalChat.title}</span>
            {activityByChat[generalChat.id] && <span className="emmy2-working-dot" title="Emmy arbeitet gerade" />}
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

        {CATEGORY_ORDER.map((category) => {
          const group = taskChats.filter((c) => categoryOf(c) === category);
          if (group.length === 0) return null;
          return (
            <div key={category} className="emmy2-group">
              <div className="emmy2-group-head">
                {CATEGORY_ICON[category]} {CATEGORY_LABEL[category]} <span className="emmy2-group-count">{group.length}</span>
              </div>
              {group.map((c) => {
                const progress = progressOf(c, activityByChat[c.id]);
                return (
                  <button
                    key={c.id}
                    className={`emmy2-chat-row${selectedId === c.id ? " active" : ""}`}
                    onClick={() => openChat(c.id)}
                  >
                    <span className="emmy2-chat-lines">
                      <span className="emmy2-chat-title">{c.title}</span>
                      <span className="emmy2-chat-sub">
                        {activityByChat[c.id]
                          ? "arbeitet gerade daran…"
                          : category === "research" && c.dueAt
                            ? `bis ${formatDue(c.dueAt)}`
                            : category === "recurring" && c.intervalHours
                              ? `${formatInterval(c.intervalHours)} · ${nextCheckLabel(c, now)}`
                              : STATUS_LABEL[c.status]}
                      </span>
                      <ProgressMeta sourcesSearched={progress.sourcesSearched} knowledgeLevel={progress.knowledgeLevel} />
                    </span>
                    {activityByChat[c.id] ? (
                      <span className="emmy2-working-dot" title="Emmy arbeitet gerade" />
                    ) : (
                      <span className={`emmy2-status-dot emmy2-status-${c.status}`} />
                    )}
                  </button>
                );
              })}
            </div>
          );
        })}

        <button className={`emmy2-chat-row emmy2-archive-row${archiveOpen ? " active" : ""}`} onClick={() => void loadArchive()}>
          <span className="emmy2-chat-title">🗄 Archiv</span>
        </button>
      </aside>

      <section className="emmy2-main">
        {archiveOpen ? (
          <ArchiveView
            entries={archive}
            openEntry={openArchiveEntry}
            onBack={() => (openArchiveEntry ? setOpenArchiveEntry(null) : setArchiveOpen(false))}
            onOpen={(entry) => void showArchiveEntry(entry)}
            onPurge={(entry) => void purgeArchiveEntry(entry)}
            onOpenDocument={(message) =>
              openArchiveEntry && setOpenDocument({ message, chatTitle: openArchiveEntry.chat.title })
            }
            onSendToProject={(message) =>
              setProjectPickerRequest({ text: message.text, heading: "An welches Projekt-Terminal?" })
            }
            onImplementInProject={(message) =>
              openArchiveEntry &&
              setProjectPickerRequest({
                text: buildImplementationPrompt(message.text, openArchiveEntry.chat.title),
                heading: "Recherche-Ergebnis umsetzen in…",
              })
            }
            error={error}
          />
        ) : !selectedChat ? (
          <p className="empty-hint">Wähle links einen Chat oder leg eine Aufgabe an.</p>
        ) : (
          <>
            <header className="emmy2-conv-head">
              <button className="emmy2-back" onClick={() => setSelectedId(null)} title="Zurück">
                ‹
              </button>
              <ChatTitle chat={selectedChat} onRename={renameChat} />
              <div className="emmy2-conv-actions">
                {selectedChat.kind === "task" && (
                  <>
                    <select
                      value={categoryOf(selectedChat)}
                      title="Kategorie"
                      onChange={(e) =>
                        void patchChat(
                          selectedChat.id,
                          { category: e.target.value as EmmyCategory },
                          "Kategorie konnte nicht geändert werden.",
                        )
                      }
                    >
                      {CATEGORY_ORDER.map((c) => (
                        <option key={c} value={c}>
                          {CATEGORY_ICON[c]} {CATEGORY_LABEL[c]}
                        </option>
                      ))}
                    </select>
                    <select
                      value={selectedChat.status}
                      title="Status"
                      onChange={(e) =>
                        void patchChat(
                          selectedChat.id,
                          { status: e.target.value as EmmyTaskStatus },
                          "Status konnte nicht geändert werden.",
                        )
                      }
                    >
                      {STATUS_ORDER.map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  </>
                )}
                {selectedChat.kind === "task" &&
                  categoryOf(selectedChat) === "research" &&
                  selectedChat.researchPhase === "discussion" && (
                    <button
                      className="emmy2-final-doc"
                      disabled={sending || !!activeActivity}
                      onClick={() => void sendMessage({ requestFinalDocument: true })}
                      title="Fasst die gesamte Recherche und Unterhaltung in einem Abschlussdokument zusammen"
                    >
                      📘 Abschlussdokument erstellen
                    </button>
                  )}
                <button
                  className="emmy2-delete"
                  onClick={() => void removeChat(selectedChat)}
                  title={selectedChat.kind === "general" ? "Chat leeren (Verlauf wird archiviert)" : "Löschen (Verlauf wird archiviert)"}
                >
                  🗑
                </button>
              </div>
            </header>

            {selectedChat.kind === "task" && categoryOf(selectedChat) === "research" && (
              <div className="emmy2-conv-meta">
                <label>
                  Zeitfenster bis
                  <input
                    type="date"
                    value={selectedChat.dueAt ? toDateInput(selectedChat.dueAt) : ""}
                    onChange={(e) =>
                      void patchChat(
                        selectedChat.id,
                        { dueAt: fromDateInput(e.target.value) },
                        "Zeitfenster konnte nicht gesetzt werden.",
                      )
                    }
                  />
                </label>
              </div>
            )}
            {selectedChat.kind === "task" &&
              (selectedChat.sourcesSearched !== undefined || selectedChat.knowledgeLevel !== undefined) &&
              !activeActivity && (
                <div className="emmy2-conv-meta">
                  <span>Rechercheeinblick:</span>
                  <ProgressMeta sourcesSearched={selectedChat.sourcesSearched} knowledgeLevel={selectedChat.knowledgeLevel} />
                </div>
              )}
            {selectedChat.kind === "task" && categoryOf(selectedChat) === "recurring" && (
              <div className="emmy2-conv-meta">
                <label>
                  Check alle
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={selectedChat.intervalHours ?? 24}
                    onChange={(e) =>
                      void patchChat(
                        selectedChat.id,
                        { intervalHours: Number(e.target.value) || null },
                        "Intervall konnte nicht gesetzt werden.",
                      )
                    }
                  />
                  Stunden
                </label>
                <span className="emmy2-chat-sub">{nextCheckLabel(selectedChat, now)}</span>
              </div>
            )}

            <div className="emmy2-messages">
              {messages.length === 0 && !activeActivity && <p className="empty-hint">Noch keine Nachrichten.</p>}
              {messages.map((m) => (
                <MessageBubble
                  key={m.id}
                  message={m}
                  onOpenDocument={() => setOpenDocument({ message: m, chatTitle: selectedChat.title })}
                  onSendToProject={() =>
                    setProjectPickerRequest({ text: m.text, heading: "An welches Projekt-Terminal?" })
                  }
                  onImplementInProject={() =>
                    setProjectPickerRequest({
                      text: buildImplementationPrompt(m.text, selectedChat.title),
                      heading: "Recherche-Ergebnis umsetzen in…",
                    })
                  }
                />
              ))}
              {activeActivity && <ActivityBubble activity={activeActivity} now={now} />}
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
      {openDocument && (
        <EmmyDocumentViewer
          message={openDocument.message}
          chatTitle={openDocument.chatTitle}
          onClose={() => setOpenDocument(null)}
        />
      )}
      {projectPickerRequest && (
        <ProjectPickerModal
          text={projectPickerRequest.text}
          heading={projectPickerRequest.heading}
          onClose={() => setProjectPickerRequest(null)}
          onSent={(projectId) => {
            setProjectPickerRequest(null);
            onOpenProject?.(projectId);
          }}
        />
      )}
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

/** How many sources she's been through, and how well she now knows the topic — both self-reported. */
function ProgressMeta({
  sourcesSearched,
  knowledgeLevel,
}: {
  sourcesSearched?: number;
  knowledgeLevel?: number;
}) {
  if (sourcesSearched === undefined && knowledgeLevel === undefined) return null;
  return (
    <span className="emmy2-progress-meta">
      {sourcesSearched !== undefined && (
        <span className="emmy2-source-badge" title="Bisher durchsuchte Quellen">
          🔎 {sourcesSearched}
        </span>
      )}
      {knowledgeLevel !== undefined && (
        <span className="emmy2-knowledge" title={`Wissensstand: ${knowledgeLevel}%`}>
          <span className="emmy2-knowledge-bar">
            <span className="emmy2-knowledge-fill" style={{ width: `${knowledgeLevel}%` }} />
          </span>
          <span className="emmy2-knowledge-pct">{knowledgeLevel}%</span>
        </span>
      )}
    </span>
  );
}

/** Sits where Emmy's next bubble will be: what she's doing, and for how long. */
function ActivityBubble({ activity, now }: { activity: EmmyActivity; now: number }) {
  return (
    <div className="emmy2-bubble emmy2-bubble-emmy emmy2-bubble-working">
      <span className="emmy2-typing" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <p>{activity.note}</p>
      <ProgressMeta sourcesSearched={activity.sourcesSearched} knowledgeLevel={activity.knowledgeLevel} />
      <span className="emmy2-bubble-time">{formatSince(activity.since, now)}</span>
    </div>
  );
}

function ArchiveView({
  entries,
  openEntry,
  onBack,
  onOpen,
  onPurge,
  onOpenDocument,
  onSendToProject,
  onImplementInProject,
  error,
}: {
  entries: EmmyArchiveSummary[];
  openEntry: EmmyArchiveEntry | null;
  onBack: () => void;
  onOpen: (entry: EmmyArchiveSummary) => void;
  onPurge: (entry: EmmyArchiveSummary) => void;
  onOpenDocument: (message: EmmyMessage) => void;
  onSendToProject: (message: EmmyMessage) => void;
  onImplementInProject: (message: EmmyMessage) => void;
  error: string | null;
}) {
  return (
    <>
      <header className="emmy2-conv-head">
        <button className="emmy2-back" onClick={onBack} title="Zurück">
          ‹
        </button>
        <h3 className="emmy2-conv-title">{openEntry ? openEntry.chat.title : "Archiv"}</h3>
      </header>
      {error && <p className="emmy2-error">{error}</p>}

      {openEntry ? (
        <div className="emmy2-messages">
          <p className="empty-hint">
            Archiviert am {formatTimestamp(openEntry.archivedAt)} — nur zum Nachlesen.
          </p>
          {openEntry.messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              onOpenDocument={() => onOpenDocument(m)}
              onSendToProject={() => onSendToProject(m)}
              onImplementInProject={() => onImplementInProject(m)}
            />
          ))}
        </div>
      ) : (
        <div className="emmy2-messages">
          {entries.length === 0 && <p className="empty-hint">Noch nichts archiviert.</p>}
          {entries.map((entry) => (
            <div key={entry.id} className="emmy2-archive-item">
              <button className="emmy2-archive-open" onClick={() => onOpen(entry)}>
                <span className="emmy2-chat-title">
                  {entry.category ? `${CATEGORY_ICON[entry.category]} ` : entry.kind === "general" ? "💬 " : ""}
                  {entry.title}
                </span>
                <span className="emmy2-chat-sub">
                  {entry.messageCount} Nachrichten · {formatTimestamp(entry.archivedAt)}
                </span>
              </button>
              <button className="emmy2-delete" onClick={() => onPurge(entry)} title="Endgültig löschen">
                🗑
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function MessageBubble({
  message,
  onOpenDocument,
  onSendToProject,
  onImplementInProject,
}: {
  message: EmmyMessage;
  onOpenDocument: () => void;
  onSendToProject: () => void;
  onImplementInProject: () => void;
}) {
  const isFinalDocument = message.role === "emmy" && message.isFinalDocument === true;
  const needsClarification = message.role === "emmy" && message.needsClarification === true;
  const isLongReport = message.role === "emmy" && (isFinalDocument || message.text.length > LONG_REPORT_CHARS);
  return (
    <div className={`emmy2-bubble emmy2-bubble-${message.role}${isLongReport ? " emmy2-bubble-report" : ""}`}>
      {needsClarification && <span className="emmy2-clarify-badge">❓ Rückfrage vor der Recherche</span>}
      {isLongReport && (
        <div className="emmy2-report-actions">
          <span className="emmy2-report-badge">{isFinalDocument ? "📘 Abschlussdokument" : "📄 Ausführlicher Bericht"}</span>
          <span className="emmy2-report-buttons">
            <button onClick={onOpenDocument}>Als Dokument öffnen</button>
            <button className="emmy2-implement-button" onClick={onImplementInProject} title="Recherche-Ergebnis direkt in einem Projekt umsetzen">
              🚀 In Projekt umsetzen
            </button>
          </span>
        </div>
      )}
      {message.text &&
        (message.role === "emmy" ? (
          <div className={isLongReport ? "emmy2-report-preview" : "emmy2-markdown"}>{renderMiniMarkdown(message.text)}</div>
        ) : (
          <p>{message.text}</p>
        ))}
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
      <div className="emmy2-bubble-footer">
        <span className="emmy2-bubble-time">{formatTimestamp(message.at)}</span>
        {message.text && (
          <button className="emmy2-bubble-to-project" onClick={onSendToProject} title="In ein Projekt-Terminal senden">
            → Projekt
          </button>
        )}
      </div>
    </div>
  );
}

/** Lets the user pick a project to push some text into as a prompt in that project's terminal — either a raw forwarded message or a wrapped "implement this research" instruction. */
function ProjectPickerModal({
  text,
  heading,
  onClose,
  onSent,
}: {
  text: string;
  heading: string;
  onClose: () => void;
  onSent: (projectId: string) => void;
}) {
  const [projects, setProjects] = useState<{ id: string; dirName: string; name?: string; icon?: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [scaffolding, setScaffolding] = useState(false);

  useEffect(() => {
    api
      .get<{ id: string; dirName: string; name?: string; icon?: string }[]>("/api/projects")
      .then(setProjects)
      .catch(() => setError("Projekte konnten nicht geladen werden."));
  }, []);

  const send = async (projectId: string) => {
    setSendingId(projectId);
    setError(null);
    try {
      await api.post(`/api/projects/${projectId}/terminal-input`, { text });
      onSent(projectId);
    } catch {
      setError("Senden ans Terminal fehlgeschlagen.");
      setSendingId(null);
    }
  };

  const createAndSend = async () => {
    const name = newProjectName.trim();
    if (!name) return;
    setScaffolding(true);
    setError(null);
    try {
      const project = await api.post<{ id: string }>("/api/projects/scaffold", {
        name,
        initialPrompt: text,
      });
      onSent(project.id);
    } catch {
      setError("Neues Projekt konnte nicht angelegt werden.");
      setScaffolding(false);
    }
  };

  return (
    <div className="home-modal-backdrop" onClick={onClose}>
      <div className="emmy2-project-picker" onClick={(e) => e.stopPropagation()}>
        <header className="emmy2-doc-head">
          <h3>{heading}</h3>
          <button onClick={onClose} title="Schließen">
            ✕
          </button>
        </header>
        {error && <p className="emmy2-error">{error}</p>}
        <div className="emmy2-project-picker-list">
          {projects === null && <p className="empty-hint">Lädt…</p>}
          {projects?.length === 0 && !showNewProject && <p className="empty-hint">Noch keine Projekte angelegt.</p>}
          {projects?.map((p) => (
            <button
              key={p.id}
              className="emmy2-project-picker-item"
              disabled={sendingId !== null || scaffolding}
              onClick={() => void send(p.id)}
            >
              <span className="emmy2-project-picker-icon">{p.icon || defaultProjectIcon(p.id)}</span>
              <span className="emmy2-project-picker-name">{p.name || p.dirName}</span>
              {sendingId === p.id && <span className="emmy2-project-picker-sending">sende…</span>}
            </button>
          ))}
        </div>
        {showNewProject ? (
          <div className="emmy2-project-picker-new">
            <input
              type="text"
              placeholder="Name des neuen Projekts"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              disabled={scaffolding}
              autoFocus
            />
            <button onClick={() => void createAndSend()} disabled={scaffolding || newProjectName.trim().length === 0}>
              {scaffolding ? "Lege an…" : "Anlegen & umsetzen"}
            </button>
          </div>
        ) : (
          <button
            className="emmy2-project-picker-new-toggle"
            disabled={sendingId !== null}
            onClick={() => setShowNewProject(true)}
          >
            + Neues Projekt anlegen
          </button>
        )}
      </div>
    </div>
  );
}

/** Full-page reader for a long report: the bubble only ever shows a capped preview of it. */
function EmmyDocumentViewer({
  message,
  chatTitle,
  onClose,
}: {
  message: EmmyMessage;
  chatTitle: string;
  onClose: () => void;
}) {
  return (
    <div className="home-modal-backdrop" onClick={onClose}>
      <div className="emmy2-doc-panel" onClick={(e) => e.stopPropagation()}>
        <header className="emmy2-doc-head">
          <h3>{chatTitle}</h3>
          <div className="emmy2-doc-actions">
            <button onClick={() => downloadAsMarkdown(message.text, downloadFilenameFor(chatTitle, message.at))}>
              ⬇️ Herunterladen (.md)
            </button>
            <button onClick={onClose} title="Schließen">
              ✕
            </button>
          </div>
        </header>
        <div className="emmy2-doc-body emmy2-markdown">{renderMiniMarkdown(message.text)}</div>
      </div>
    </div>
  );
}
