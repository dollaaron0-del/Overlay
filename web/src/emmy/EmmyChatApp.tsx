import { useEffect, useMemo, useRef, useState } from "react";
import { EMMY_LONG_REPORT_CHARS } from "@overlay/shared";
import type {
  EmmyActivity,
  EmmyArchiveEntry,
  EmmyArchiveSummary,
  EmmyCategory,
  EmmyChat,
  EmmyMessage,
  EmmyServerMessage,
  EmmyTaskStatus,
  EmmyTopicWindow,
  ProgramId,
  ProgramMeta,
} from "@overlay/shared";
import { api, ApiError } from "../api/client";
import { ReconnectingSocket, wsUrl } from "../api/ws";
import { formatTimestamp } from "../format";
import { renderMiniMarkdown } from "./miniMarkdown";
import { defaultProjectIcon } from "../os/project-icon";
import { SystemStatsWidget } from "../os/widgets/SystemStatsWidget";
import { ModelStatusWidget } from "../os/widgets/ModelStatusWidget";
import { BackupWidget } from "../os/widgets/BackupWidget";
import { TerminalPanel } from "../terminal/TerminalPanel";
import { SettingsApp } from "../settings/SettingsApp";

/** Above this length a reply gets "open as document"/"download" actions instead of only living in the bubble. Kept in sync with the server's PDF-generation threshold. */
const LONG_REPORT_CHARS = EMMY_LONG_REPORT_CHARS;

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

/**
 * Client-side only: prints the already-rendered document body via a hidden
 * iframe (so the print dialog only shows the report, not the whole app) and
 * lets the user pick "Save as PDF" — no server round-trip or PDF library needed.
 */
function printAsPdf(title: string, bodyHtml: string): void {
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument;
  if (!doc) {
    document.body.removeChild(iframe);
    return;
  }
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
    <style>
      body { font-family: system-ui, sans-serif; color: #111; padding: 2rem; line-height: 1.5; max-width: 800px; margin: 0 auto; }
      h1, h2, h3 { margin-top: 1.4em; }
      table { border-collapse: collapse; width: 100%; }
      th, td { border: 1px solid #ccc; padding: 0.4rem 0.6rem; text-align: left; }
      pre { background: #f4f4f4; padding: 0.8rem; overflow-x: auto; white-space: pre-wrap; }
      code { background: #f4f4f4; padding: 0.1rem 0.3rem; border-radius: 3px; }
    </style>
  </head><body>${bodyHtml}</body></html>`);
  doc.close();
  const cleanup = () => {
    if (iframe.parentNode) document.body.removeChild(iframe);
  };
  iframe.onload = () => {
    const win = iframe.contentWindow;
    if (!win) return cleanup();
    win.addEventListener("afterprint", cleanup);
    win.focus();
    win.print();
  };
  window.setTimeout(cleanup, 60_000);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
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
  instant: "[!]",
  research: "[?]",
  recurring: "[R]",
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

/** Minutes until a recurring chat's next check is due (negative/zero = overdue). */
function minutesUntilNextCheck(chat: EmmyChat, now: number): number | null {
  if (!chat.intervalHours) return null;
  const last = chat.lastRecurringCheckAt ?? chat.createdAt;
  const dueAt = new Date(last).getTime() + chat.intervalHours * 3_600_000;
  return Math.round((dueAt - now) / 60_000);
}

function formatMinutesLeft(minutesLeft: number): string {
  if (minutesLeft <= 0) return "fällig";
  if (minutesLeft < 60) return `in ${minutesLeft} Min.`;
  const hoursLeft = Math.round(minutesLeft / 60);
  if (hoursLeft < 24) return `in ${hoursLeft} Std.`;
  return `in ${Math.round(hoursLeft / 24)} Tagen`;
}

/**
 * "nächster Check: in ca. 2 Std." — purely client-side, from
 * lastRecurringCheckAt (or createdAt, if it has never run yet) + intervalHours.
 * The scheduler itself decides when a check actually fires; this is only a
 * display estimate.
 */
function nextCheckLabel(chat: EmmyChat, now: number): string {
  const minutesLeft = minutesUntilNextCheck(chat, now);
  if (minutesLeft === null) return "";
  return `nächster Check: ${formatMinutesLeft(minutesLeft)}`;
}

/** Across several recurring chats, the one due soonest — used by the collapsed summary line. */
function soonestNextCheckLabel(chats: EmmyChat[], now: number): string {
  const all = chats.map((c) => minutesUntilNextCheck(c, now)).filter((m): m is number => m !== null);
  if (all.length === 0) return "";
  return `nächster Check: ${formatMinutesLeft(Math.min(...all))}`;
}

/** A research task counts as "urgent" (worth its own card) inside 3 days of its due date. */
function isDueSoon(chat: EmmyChat, now: number): boolean {
  if (categoryOf(chat) !== "research" || !chat.dueAt) return false;
  return new Date(chat.dueAt).getTime() - now <= 3 * 24 * 3_600_000;
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

function IconCheck() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="var(--c-on-solid)" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline className="toggle-flat-check" points="20 6 9 17 4 12" />
    </svg>
  );
}

/** Gemeinsamer Rahmen für alle Linien-Icons — einfarbig über currentColor,
 * folgt also automatisch Text-/Akzentfarbe. Kein Emoji, keine Klammer-Optik
 * (Aarons Vorgabe vom 26.08.). */
function Icon({ size = 16, children }: { size?: number; children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

function IconPaperclip(props: { size?: number }) {
  return (
    <Icon {...props}>
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </Icon>
  );
}

function IconTrash(props: { size?: number }) {
  return (
    <Icon {...props}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </Icon>
  );
}

function IconPencil(props: { size?: number }) {
  return (
    <Icon {...props}>
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </Icon>
  );
}

function IconSearch(props: { size?: number }) {
  return (
    <Icon {...props}>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </Icon>
  );
}

function IconLink(props: { size?: number }) {
  return (
    <Icon {...props}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </Icon>
  );
}

function IconTerminal(props: { size?: number }) {
  return (
    <Icon {...props}>
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </Icon>
  );
}

function IconUser(props: { size?: number }) {
  return (
    <Icon {...props}>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </Icon>
  );
}

function IconRepeat(props: { size?: number }) {
  return (
    <Icon {...props}>
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </Icon>
  );
}

function IconX(props: { size?: number }) {
  return (
    <Icon {...props}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </Icon>
  );
}

function IconChevronDown(props: { size?: number }) {
  return (
    <Icon {...props}>
      <polyline points="6 9 12 15 18 9" />
    </Icon>
  );
}

function IconTrendingUp(props: { size?: number }) {
  return (
    <Icon {...props}>
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
      <polyline points="17 6 23 6 23 12" />
    </Icon>
  );
}

function IconGraduationCap(props: { size?: number }) {
  return (
    <Icon {...props}>
      <path d="M22 10 12 5 2 10l10 5 10-5z" />
      <path d="M6 12v5c0 1 2.7 3 6 3s6-2 6-3v-5" />
    </Icon>
  );
}

function IconSidebar(props: { size?: number }) {
  return (
    <Icon {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="15" y1="4" x2="15" y2="20" />
    </Icon>
  );
}

function IconRefresh(props: { size?: number }) {
  return (
    <Icon {...props}>
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </Icon>
  );
}

/**
 * Service-Worker abmelden + alle Caches leeren + neu laden. Für die Fälle, in
 * denen der PWA-Precache alten Code festhält (Kiosk-Display ohne Tastatur,
 * iPad-Safari das zäh alte SWs hält). Danach zieht sich der Client alles frisch.
 */
async function hardReload() {
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    /* egal — trotzdem neu laden */
  } finally {
    location.reload();
  }
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
  const [hostTerminalOpen, setHostTerminalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const centerTextareaRef = useRef<HTMLTextAreaElement>(null);
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
      } else if (msg.type === "topic-windows") {
        setTopicWindows(msg.topicWindows);
      } else if (msg.type === "chat-cleared") {
        // The general chat's history was archived + blanked server-side (/neu
        // or a research spin-off). Drop the local copy and the "loaded" mark so
        // the fresh transcript (just the seed line) is refetched as the truth.
        const clearedId = msg.chatId;
        setMessagesByChat((prev) => ({ ...prev, [clearedId]: [] }));
        setLoadedChats((prev) => {
          if (!prev.has(clearedId)) return prev;
          const next = new Set(prev);
          next.delete(clearedId);
          return next;
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
      api
        .get<EmmyTopicWindow[]>("/api/emmy/topic-windows")
        .then(setTopicWindows)
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

  // Initial chat list + activity (in case the socket is slow). No auto-select:
  // the center stage (search bar + ambient dashboards) is the default landing
  // view; a chat only opens when the user actually picks one.
  useEffect(() => {
    api
      .get<EmmyChat[]>("/api/emmy/chats")
      .then(setChats)
      .catch(() => {});
    api
      .get<EmmyActivity[]>("/api/emmy/activity")
      .then(setActivities)
      .catch(() => {});
    api
      .get<EmmyTopicWindow[]>("/api/emmy/topic-windows")
      .then(setTopicWindows)
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

  const taskChats = useMemo(() => chats.filter((c) => c.kind === "task"), [chats]);
  const generalChat = chats.find((c) => c.kind === "general") ?? null;

  // The center stage doubles as the live general-chat transcript, so its
  // history has to load as soon as the chat is known — not only once it's
  // been "opened" like the task chats.
  useEffect(() => {
    if (!generalChat || loadedChats.has(generalChat.id)) return;
    const id = generalChat.id;
    api
      .get<EmmyMessage[]>(`/api/emmy/chats/${id}/messages`)
      .then((msgs) => {
        setMessagesByChat((prev) => ({ ...prev, [id]: msgs }));
        setLoadedChats((prev) => new Set(prev).add(id));
      })
      .catch(() => {});
  }, [generalChat?.id, loadedChats]);

  const centerMessages = generalChat ? (messagesByChat[generalChat.id] ?? []) : [];
  const centerActivity = generalChat ? activityByChat[generalChat.id] : undefined;
  const centerHasThread = centerMessages.length > 0 || !!centerActivity;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, centerMessages.length, selectedId, activeActivity?.note, centerActivity?.note]);

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

  const sendMessage = async (opts?: { requestFinalDocument?: boolean; chatId?: string }) => {
    const targetId = opts?.chatId ?? selectedId;
    if (!targetId) return;
    const requestFinalDocument = opts?.requestFinalDocument === true;
    const text = draft.trim() || (requestFinalDocument ? "Bitte erstelle das Abschlussdokument." : "");
    if (!text && pending.length === 0) return;
    setDraft("");
    const attachments = pending;
    setPending([]);
    setSending(true);
    setError(null);
    try {
      await api.post(`/api/emmy/chats/${targetId}/messages`, {
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

  const showCenter = !selectedId && !archiveOpen;
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Which check / research task, if any, is open in its detail window.
  const [checkWindowId, setCheckWindowId] = useState<string | null>(null);
  // Which program dashboard, if any, is open in its floating window.
  const [dashboardId, setDashboardId] = useState<ProgramId | null>(null);
  // Topic windows live on the server (persisted, pushed over /ws/emmy); the
  // z-order is a pure view concern and stays local.
  const [topicWindows, setTopicWindows] = useState<EmmyTopicWindow[]>([]);
  const [topicOrder, setTopicOrder] = useState<string[]>([]);

  const openTopicWindow = (title: string, content: string) => {
    void api
      .post("/api/emmy/topic-windows", { title, content })
      .catch(() => setError("Themen-Fenster konnte nicht erstellt werden."));
  };

  // A program dashboard opens as its own floating window (same chrome as the
  // topic/check windows): an iframe onto the program's real UI, reverse-proxied
  // same-origin under /x/<id>/ (no CORS, no external tab). Ephemeral: one at a
  // time, closes with X.
  const openDashboard = (id: ProgramId) => {
    setSidebarOpen(false);
    setDashboardId(id);
  };
  const focusTopicWindow = (id: string) =>
    setTopicOrder((o) => (o[o.length - 1] === id ? o : [...o.filter((x) => x !== id), id]));
  /** Live, local-only geometry update during a drag — no network. */
  const dragTopicWindow = (id: string, patch: Partial<EmmyTopicWindow>) =>
    setTopicWindows((ws) => ws.map((w) => (w.id === id ? { ...w, ...patch } : w)));
  const persistTopicWindow = (id: string, patch: Partial<EmmyTopicWindow>) => {
    void api.patch(`/api/emmy/topic-windows/${id}`, patch).catch(() => {});
  };
  const minimizeTopicWindow = (id: string) => persistTopicWindow(id, { minimized: true });
  const deleteTopicWindow = (id: string) => {
    void api.delete(`/api/emmy/topic-windows/${id}`).catch(() => {});
  };

  const startCenterSend = () => {
    if (!generalChat) return;
    // Stay on the center stage — the transcript renders right here now.
    void sendMessage({ chatId: generalChat.id });
  };

  const onCenterKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      startCenterSend();
    }
  };

  // The composer grows with its content instead of scrolling inside a fixed
  // box — you always see the whole message. The thread above yields the
  // space (see .emmy2-center-stage layout). Runs on every draft change so it
  // also shrinks back to one line after sending. Hard cap at 50vh so a
  // pasted wall of text can't swallow the screen.
  useEffect(() => {
    const el = centerTextareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, window.innerHeight * 0.5)}px`;
  }, [draft]);

  // Strg/Cmd+B toggles the overview drawer (mirrors the corner trigger).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "b" || e.key === "B")) {
        e.preventDefault();
        setSidebarOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="emmy2-app" data-view={showCenter ? "center" : "chat"}>
      <button
        className="emmy2-sidebar-trigger"
        onClick={() => setSidebarOpen(true)}
        title="Übersicht (Strg+B)"
      >
        <IconSidebar size={15} />
        <span>Emmy</span>
      </button>
      <EmmySidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        taskChats={taskChats}
        activityByChat={activityByChat}
        onOpenDashboard={openDashboard}
        onOpenCheck={(id) => {
          setSidebarOpen(false);
          setCheckWindowId(id);
        }}
      />
      {showCenter && (
        <div className="emmy2-center-stage" data-conversation={centerHasThread}>
          {centerHasThread && (
            <div className="emmy2-center-thread">
              {centerMessages.map((m) => (
                <MessageBubble
                  key={m.id}
                  message={m}
                  onOpenDocument={() => setOpenDocument({ message: m, chatTitle: generalChat?.title ?? "Emmy" })}
                  onSendToProject={() =>
                    setProjectPickerRequest({ text: m.text, heading: "An welches Projekt-Terminal?" })
                  }
                  onImplementInProject={() =>
                    setProjectPickerRequest({
                      text: buildImplementationPrompt(m.text, generalChat?.title ?? "Emmy"),
                      heading: "Recherche-Ergebnis umsetzen in…",
                    })
                  }
                  onOpenTopicWindow={() => openTopicWindow(topicTitleFrom(m.text), m.text)}
                />
              ))}
              {centerActivity && <ActivityBubble activity={centerActivity} now={now} />}
              <div ref={messagesEndRef} />
            </div>
          )}
          <div className="emmy2-center-input-wrap">
            {pending.length > 0 && (
              <div className="emmy2-pending">
                {pending.map((p, i) => (
                  <span key={i} className="emmy2-pending-chip">
                    <IconPaperclip size={12} /> {p.originalName}
                    <button onClick={() => setPending((prev) => prev.filter((_, j) => j !== i))}>×</button>
                  </span>
                ))}
              </div>
            )}
            <div className="emmy2-center-input-row">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                hidden
                onChange={(e) => void addFiles(e.target.files)}
              />
              <button
                className="emmy2-attach"
                onClick={() => fileInputRef.current?.click()}
                title="Datei anhängen"
              >
                <IconPaperclip />
              </button>
              <textarea
                ref={centerTextareaRef}
                className="emmy2-center-textarea"
                rows={1}
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onCenterKeyDown}
                placeholder="Was gibt's?"
              />
              <button
                className="emmy2-send"
                onClick={startCenterSend}
                disabled={sending || (!draft.trim() && pending.length === 0)}
              >
                Senden
              </button>
            </div>
            {error && <p className="emmy2-error">{error}</p>}
          </div>
        </div>
      )}

      {!showCenter && (
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
        ) : !selectedChat ? null : (
          <>
            <header className="emmy2-conv-head">
              <button className="emmy2-back" onClick={() => setSelectedId(null)} title="Zurück">
                <kbd>{"[<]"}</kbd>
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
                      Abschlussdokument erstellen
                    </button>
                  )}
                <button
                  className="emmy2-delete"
                  onClick={() => void removeChat(selectedChat)}
                  title={selectedChat.kind === "general" ? "Chat leeren (Verlauf wird archiviert)" : "Löschen (Verlauf wird archiviert)"}
                >
                  <IconTrash />
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
                  onOpenTopicWindow={() => openTopicWindow(topicTitleFrom(m.text), m.text)}
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
                    <IconPaperclip size={12} /> {p.originalName}
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
                <IconPaperclip />
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
      )}
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
      {hostTerminalOpen && (
        <div className="home-modal-backdrop" onClick={() => setHostTerminalOpen(false)}>
          <div className="emmy2-terminal-panel" onClick={(e) => e.stopPropagation()}>
            <header className="emmy2-doc-head">
              <h3>Server-Terminal</h3>
              <button onClick={() => setHostTerminalOpen(false)} title="Schließen">
                <kbd>[X]</kbd>
              </button>
            </header>
            <div className="emmy2-terminal-body">
              <TerminalPanel wsPath="/ws/host-terminal" />
            </div>
          </div>
        </div>
      )}
      {settingsOpen && (
        <div className="home-modal-backdrop" onClick={() => setSettingsOpen(false)}>
          <div className="emmy2-doc-panel" onClick={(e) => e.stopPropagation()}>
            <header className="emmy2-doc-head">
              <h3>Konto</h3>
              <button onClick={() => setSettingsOpen(false)} title="Schließen">
                <kbd>[X]</kbd>
              </button>
            </header>
            <div className="emmy2-doc-body">
              <SettingsApp />
            </div>
          </div>
        </div>
      )}
      {topicWindows
        .filter((w) => !w.minimized)
        .map((w) => (
          <TopicWindow
            key={w.id}
            win={w}
            z={20 + Math.max(0, topicOrder.indexOf(w.id))}
            onFocus={() => focusTopicWindow(w.id)}
            onClose={() => minimizeTopicWindow(w.id)}
            onChange={(patch) => dragTopicWindow(w.id, patch)}
            onCommit={(geometry) => persistTopicWindow(w.id, geometry)}
          />
        ))}
      {(() => {
        const c = checkWindowId ? taskChats.find((t) => t.id === checkWindowId) : undefined;
        return c ? (
          <CheckWindow
            chat={c}
            now={now}
            onClose={() => setCheckWindowId(null)}
            onMarkDone={() => {
              void patchChat(c.id, { status: "done" }, "Konnte nicht als erledigt markiert werden.");
              setCheckWindowId(null);
            }}
          />
        ) : null;
      })()}
      {dashboardId && <DashboardWindow id={dashboardId} onClose={() => setDashboardId(null)} />}
    </div>
  );
}

/**
 * One line in the reduced sidebar list: a coloured status dot (orange =
 * recurring check, blue = deep research) plus the task's short title. The
 * dot pulses gently while Emmy is actively working the item.
 */
function StatusRow({
  title,
  kind,
  active,
  onClick,
}: {
  title: string;
  kind: "check" | "research";
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className="emmy2-status-row" onClick={onClick}>
      <span className="emmy2-status-row-title">{title}</span>
      <span
        className={`emmy2-status-dot emmy2-status-dot--${kind}${active ? " is-active" : ""}`}
        aria-hidden="true"
      />
    </button>
  );
}

/**
 * Right-side overview drawer (Strg/Cmd+B or the corner trigger). The home
 * screen stays bare — everything glanceable-but-not-ambient lives here:
 * server health, recurring checks, other open tasks, later the Python
 * dashboards. Slides over the chat, ESC or scrim-click closes.
 */
function EmmySidebar({
  open,
  onClose,
  taskChats,
  activityByChat,
  onOpenDashboard,
  onOpenCheck,
}: {
  open: boolean;
  onClose: () => void;
  taskChats: EmmyChat[];
  activityByChat: Record<string, EmmyActivity>;
  onOpenDashboard: (id: ProgramId) => void;
  onOpenCheck: (id: string) => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Radikal reduziert: jeder wiederkehrende Check bekommt eine Zeile.
  // Recherchen bleiben stehen, sobald sie einmal angelaufen sind
  // (status "in_progress") oder gerade aktiv laufen — abgeschlossene
  // behalten einen ruhigen (nicht blinkenden) blauen Punkt und geben beim
  // Klick die gesammelten Infos als Fließtext.
  const checks = taskChats.filter((c) => categoryOf(c) === "recurring" && c.status !== "done");
  const research = taskChats.filter(
    (c) =>
      categoryOf(c) === "research" &&
      c.status !== "done" &&
      (c.status === "in_progress" || !!activityByChat[c.id]),
  );

  return (
    <>
      <div className={`emmy2-sidebar-scrim${open ? " open" : ""}`} onClick={onClose} />
      <aside className={`emmy2-sidebar${open ? " open" : ""}`} aria-hidden={!open}>
        <header className="emmy2-sidebar-head">
          <span className="emmy2-sidebar-brand">
            <IconSidebar size={15} /> Emmy
          </span>
          <button onClick={onClose} title="Schließen (Esc)">
            <IconX size={15} />
          </button>
        </header>

        <div className="emmy2-sidebar-body">
          <section className="emmy2-sidebar-section">
            <SystemStatsWidget />
          </section>

          <section className="emmy2-sidebar-section">
            <h4>Modelle</h4>
            <ModelStatusWidget />
          </section>

          <section className="emmy2-sidebar-section">
            <h4>Dashboards</h4>
            <div className="emmy2-dash-links">
              <button
                type="button"
                className="emmy2-dash-card"
                onClick={() => onOpenDashboard("aktien")}
              >
                <IconTrendingUp size={28} />
                <span>Aktien-Bot</span>
              </button>
              <button
                type="button"
                className="emmy2-dash-card"
                onClick={() => onOpenDashboard("ki-nachhilfe")}
              >
                <IconGraduationCap size={28} />
                <span>KI-Nachhilfe</span>
              </button>
            </div>
          </section>

          <section className="emmy2-sidebar-section">
            <h4>Checks &amp; Recherche</h4>
            {checks.length === 0 && research.length === 0 && (
              <p className="empty-hint">Keine Checks, keine Recherchen.</p>
            )}
            {checks.map((c) => (
              <StatusRow
                key={c.id}
                title={c.title}
                kind="check"
                active={!!activityByChat[c.id]}
                onClick={() => onOpenCheck(c.id)}
              />
            ))}
            {research.map((c) => (
              <StatusRow
                key={c.id}
                title={c.title}
                kind="research"
                active={!!activityByChat[c.id]}
                onClick={() => onOpenCheck(c.id)}
              />
            ))}
          </section>

          <section className="emmy2-sidebar-section emmy2-sidebar-foot">
            <button
              type="button"
              className="emmy2-sidebar-reload"
              onClick={hardReload}
              title="Service-Worker + Cache leeren und komplett neu laden"
            >
              <IconRefresh size={13} /> Neu laden (hart)
            </button>
          </section>
        </div>
      </aside>
    </>
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
        <span className="emmy2-source-badge" title="Bisher durchsuchte Quellen" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <IconSearch size={13} /> {sourcesSearched}
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
          <kbd>{"[<]"}</kbd>
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
                  {entry.category ? `${CATEGORY_ICON[entry.category]} ` : entry.kind === "general" ? "[C] " : ""}
                  {entry.title}
                </span>
                <span className="emmy2-chat-sub">
                  {entry.messageCount} Nachrichten · {formatTimestamp(entry.archivedAt)}
                </span>
              </button>
              <button className="emmy2-delete" onClick={() => onPurge(entry)} title="Endgültig löschen">
                <IconTrash />
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
  onOpenTopicWindow,
}: {
  message: EmmyMessage;
  onOpenDocument: () => void;
  onSendToProject: () => void;
  onImplementInProject: () => void;
  onOpenTopicWindow?: () => void;
}) {
  const isFinalDocument = message.role === "emmy" && message.isFinalDocument === true;
  const needsClarification = message.role === "emmy" && message.needsClarification === true;
  const isLongReport = message.role === "emmy" && (isFinalDocument || message.text.length > LONG_REPORT_CHARS);
  return (
    <div className={`emmy2-bubble emmy2-bubble-${message.role}${isLongReport ? " emmy2-bubble-report" : ""}`}>
      {needsClarification && <span className="emmy2-clarify-badge">Rückfrage vor der Recherche</span>}
      {isLongReport && (
        <div className="emmy2-report-actions">
          <span className="emmy2-report-badge">{isFinalDocument ? "Abschlussdokument" : "Ausführlicher Bericht"}</span>
          <span className="emmy2-report-buttons">
            <button onClick={onOpenDocument}>Als Dokument öffnen</button>
            <button className="emmy2-implement-button" onClick={onImplementInProject} title="Recherche-Ergebnis direkt in einem Projekt umsetzen">
              In Projekt umsetzen
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
            <kbd>[F]</kbd> {a.originalName}
          </a>
        );
      })}
      <div className="emmy2-bubble-footer">
        <span className="emmy2-bubble-time">{formatTimestamp(message.at)}</span>
        {message.role === "emmy" && message.text && onOpenTopicWindow && (
          <button className="emmy2-bubble-action" onClick={onOpenTopicWindow} title="Als verschiebbares Themen-Fenster öffnen">
            Themen-Fenster
          </button>
        )}
      </div>
    </div>
  );
}

/** Derives a short window title from a message: first markdown heading, else
 * the first sentence/line, trimmed. */
function topicTitleFrom(text: string): string {
  const heading = text.match(/^#{1,3}\s+(.+)$/m)?.[1];
  const line = heading ?? text.split("\n").find((l) => l.trim().length > 0) ?? "Themen-Fenster";
  const clean = line.replace(/[*_`#>]/g, "").trim();
  return clean.length > 48 ? `${clean.slice(0, 47)}…` : clean;
}

/**
 * A free-floating, draggable+resizable reference window (like a browser
 * window). Emmy fills it with a compiled dossier on a topic; you push it
 * aside and keep chatting. Stage 1: spawned from a message, lives in memory
 * only. Persistence + Emmy-side generation come next.
 */
type TopicWindowGeometry = Pick<EmmyTopicWindow, "x" | "y" | "w" | "h">;

function TopicWindow({
  win,
  z,
  onFocus,
  onClose,
  onChange,
  onCommit,
}: {
  win: EmmyTopicWindow;
  z: number;
  onFocus: () => void;
  onClose: () => void;
  onChange: (patch: Partial<TopicWindowGeometry>) => void;
  onCommit: (geometry: TopicWindowGeometry) => void;
}) {
  // Drag/resize via window-level listeners (not pointer capture) so a fast
  // pointer that outruns the small header/handle still tracks. `onChange`
  // updates local state live for a smooth drag; `onCommit` persists once on
  // release.
  const start = (mode: "move" | "resize") => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onFocus();
    const sx = e.clientX;
    const sy = e.clientY;
    const { x: ox, y: oy, w: ow, h: oh } = win;
    let last: TopicWindowGeometry = { x: ox, y: oy, w: ow, h: oh };
    document.body.style.userSelect = "none";
    const onMove = (ev: PointerEvent) => {
      ev.preventDefault();
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      if (mode === "move") {
        last = {
          ...last,
          x: Math.max(0, Math.min(window.innerWidth - 80, ox + dx)),
          y: Math.max(0, Math.min(window.innerHeight - 40, oy + dy)),
        };
        onChange({ x: last.x, y: last.y });
      } else {
        last = { ...last, w: Math.max(300, ow + dx), h: Math.max(200, oh + dy) };
        onChange({ w: last.w, h: last.h });
      }
    };
    const onUp = () => {
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      onCommit(last);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div
      className="emmy2-topicwin"
      style={{ left: win.x, top: win.y, width: win.w, height: win.h, zIndex: z }}
      onPointerDownCapture={onFocus}
    >
      <header className="emmy2-topicwin-head" onPointerDown={start("move")}>
        <span className="emmy2-topicwin-title">{win.title}</span>
        <button onClick={onClose} title="In die Seitenleiste minimieren">
          <IconX size={14} />
        </button>
      </header>
      <div className="emmy2-topicwin-body emmy2-markdown">{renderMiniMarkdown(win.content)}</div>
      <div className="emmy2-topicwin-resize" onPointerDown={start("resize")} />
    </div>
  );
}

function formatResultStamp(iso: string): string {
  return new Date(iso).toLocaleString("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Detail window for one recurring check / research task. Left pane lists the
 * results (Emmy's replies, newest first); the right third is a fixed rail
 * with the task's framing — cadence/deadline, when it last ran, and the
 * original brief that says what it is meant to do. Ephemeral: opens on a
 * sidebar-row click, closes with X, geometry is not persisted.
 */
function CheckWindow({
  chat,
  now,
  onClose,
  onMarkDone,
}: {
  chat: EmmyChat;
  now: number;
  onClose: () => void;
  onMarkDone: () => void;
}) {
  const isCheck = categoryOf(chat) === "recurring";
  const [messages, setMessages] = useState<EmmyMessage[] | null>(null);
  const [geo, setGeo] = useState(() => ({
    x: Math.max(16, Math.round(window.innerWidth / 2 - 340)),
    y: Math.max(16, Math.round(window.innerHeight / 2 - 240)),
    w: 680,
    h: 480,
  }));

  useEffect(() => {
    let alive = true;
    api
      .get<EmmyMessage[]>(`/api/emmy/chats/${chat.id}/messages`)
      .then((m) => alive && setMessages(m))
      .catch(() => alive && setMessages([]));
    return () => {
      alive = false;
    };
  }, [chat.id]);

  const start = (mode: "move" | "resize") => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const sx = e.clientX;
    const sy = e.clientY;
    const { x: ox, y: oy, w: ow, h: oh } = geo;
    document.body.style.userSelect = "none";
    const onMove = (ev: PointerEvent) => {
      ev.preventDefault();
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      if (mode === "move") {
        setGeo((g) => ({
          ...g,
          x: Math.max(0, Math.min(window.innerWidth - 80, ox + dx)),
          y: Math.max(0, Math.min(window.innerHeight - 40, oy + dy)),
        }));
      } else {
        setGeo((g) => ({ ...g, w: Math.max(420, ow + dx), h: Math.max(260, oh + dy) }));
      }
    };
    const onUp = () => {
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const emmyReplies = (messages ?? []).filter((m) => m.role === "emmy");
  // Check: einzelne Läufe, neueste zuerst. Recherche: alles Gesammelte als
  // ein Fließtext — das angeforderte Abschlussdokument, sonst alle Antworten
  // in Reihenfolge aneinander.
  const results = emmyReplies.slice().reverse();
  const finalDoc = emmyReplies.find((m) => m.isFinalDocument);
  const researchText = finalDoc ? finalDoc.text : emmyReplies.map((m) => m.text).join("\n\n");
  const brief = (messages ?? []).find((m) => m.role === "me");
  const researchPhaseLabel =
    chat.researchPhase === "discussion" ? "abgeschlossen" : chat.researchPhase === "deep_research" ? "sammelt" : "—";

  return (
    <div
      className="emmy2-topicwin emmy2-checkwin"
      style={{ left: geo.x, top: geo.y, width: geo.w, height: geo.h, zIndex: 60 }}
    >
      <header className="emmy2-topicwin-head" onPointerDown={start("move")}>
        <span className="emmy2-topicwin-title">
          {isCheck ? "Check" : "Recherche"}: {chat.title}
        </span>
        <div className="emmy2-checkwin-actions">
          {!isCheck && (
            <button className="emmy2-checkwin-done" onClick={onMarkDone} title="Recherche abschließen">
              Erledigt
            </button>
          )}
          <button onClick={onClose} title="Schließen">
            <IconX size={14} />
          </button>
        </div>
      </header>
      <div className="emmy2-checkwin-body">
        <div className="emmy2-checkwin-main">
          {messages === null && <p className="empty-hint">Lädt…</p>}
          {messages !== null && emmyReplies.length === 0 && (
            <p className="empty-hint">{isCheck ? "Noch keine Checkergebnisse." : "Noch nichts gesammelt."}</p>
          )}
          {messages !== null && emmyReplies.length > 0 && isCheck &&
            results.map((m) => (
              <article key={m.id} className="emmy2-checkwin-result">
                <time className="emmy2-checkwin-result-time">{formatResultStamp(m.at)}</time>
                <div className="emmy2-markdown">{renderMiniMarkdown(m.text)}</div>
              </article>
            ))}
          {messages !== null && emmyReplies.length > 0 && !isCheck && (
            <div className="emmy2-markdown emmy2-checkwin-fliesstext">{renderMiniMarkdown(researchText)}</div>
          )}
        </div>
        <aside className="emmy2-checkwin-rail">
          <h5>Rahmenbedingungen</h5>
          <dl className="emmy2-checkwin-facts">
            {isCheck && chat.intervalHours != null && (
              <>
                <dt>Intervall</dt>
                <dd>{formatInterval(chat.intervalHours)}</dd>
              </>
            )}
            {isCheck && (
              <>
                <dt>Letzter Lauf</dt>
                <dd>{chat.lastRecurringCheckAt ? formatSince(chat.lastRecurringCheckAt, now) : "noch nie"}</dd>
              </>
            )}
            {isCheck && (
              <>
                <dt>Ergebnisse</dt>
                <dd>{messages === null ? "…" : results.length}</dd>
              </>
            )}
            {!isCheck && chat.dueAt && (
              <>
                <dt>Frist</dt>
                <dd>{formatDue(chat.dueAt)}</dd>
              </>
            )}
            {!isCheck && (
              <>
                <dt>Stand</dt>
                <dd>{researchPhaseLabel}</dd>
              </>
            )}
            {!isCheck && chat.sourcesSearched != null && (
              <>
                <dt>Quellen</dt>
                <dd>{chat.sourcesSearched}</dd>
              </>
            )}
            {!isCheck && chat.knowledgeLevel != null && (
              <>
                <dt>Wissensstand</dt>
                <dd>{chat.knowledgeLevel} %</dd>
              </>
            )}
            <dt>Angelegt</dt>
            <dd>{formatSince(chat.createdAt, now)}</dd>
          </dl>
          <h5>Auftrag</h5>
          <div className="emmy2-markdown emmy2-checkwin-brief">
            {brief ? renderMiniMarkdown(brief.text) : <span className="empty-hint">—</span>}
          </div>
        </aside>
      </div>
      <div className="emmy2-topicwin-resize" onPointerDown={start("resize")} />
    </div>
  );
}

/**
 * Floating window for a program dashboard. Loads the program's full UI (the
 * Aktien Streamlit dashboard / the KI-Nachhilfe Lernprogramm) in an iframe,
 * so the tile actually opens the program — not just a status readout. Same
 * drag/resize chrome as TopicWindow/CheckWindow; ephemeral (geometry not
 * persisted). The iframe URL comes from GET /api/programs (server config).
 */
function DashboardWindow({ id, onClose }: { id: ProgramId; onClose: () => void }) {
  const [meta, setMeta] = useState<ProgramMeta | null>(null);
  const [metaError, setMetaError] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [geo, setGeo] = useState(() => ({
    x: Math.max(16, Math.round(window.innerWidth / 2 - Math.min(600, window.innerWidth * 0.46))),
    y: Math.max(16, Math.round(window.innerHeight / 2 - Math.min(400, window.innerHeight * 0.44))),
    w: Math.min(1200, Math.round(window.innerWidth * 0.92)),
    h: Math.min(800, Math.round(window.innerHeight * 0.88)),
  }));

  useEffect(() => {
    let alive = true;
    api
      .get<ProgramMeta[]>("/api/programs")
      .then((list) => {
        if (!alive) return;
        const found = list.find((p) => p.id === id) ?? null;
        // Harden the iframe src against a stray trailing character (a garbled
        // path once wedged the dashboard as e.g. "/x/aktien/`" → 404 loop).
        const m = found ? { ...found, path: found.path.trim().replace(/[^A-Za-z0-9/_-]+$/, "") } : null;
        setMeta(m);
        setMetaError(!m);
      })
      .catch(() => alive && setMetaError(true));
    return () => {
      alive = false;
    };
  }, [id]);

  const start = (mode: "move" | "resize") => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const sx = e.clientX;
    const sy = e.clientY;
    const { x: ox, y: oy, w: ow, h: oh } = geo;
    document.body.style.userSelect = "none";
    setDragging(true); // let pointer events pass over the iframe during drag
    const onMove = (ev: PointerEvent) => {
      ev.preventDefault();
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      if (mode === "move") {
        setGeo((gg) => ({
          ...gg,
          x: Math.max(0, Math.min(window.innerWidth - 80, ox + dx)),
          y: Math.max(0, Math.min(window.innerHeight - 40, oy + dy)),
        }));
      } else {
        setGeo((gg) => ({ ...gg, w: Math.max(480, ow + dx), h: Math.max(360, oh + dy) }));
      }
    };
    const onUp = () => {
      document.body.style.userSelect = "";
      setDragging(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div
      className="emmy2-topicwin emmy2-dashwin"
      style={{ left: geo.x, top: geo.y, width: geo.w, height: geo.h, zIndex: 60 }}
    >
      <header className="emmy2-topicwin-head" onPointerDown={start("move")}>
        <span className="emmy2-topicwin-title">{meta?.title ?? "Dashboard"}</span>
        <div className="emmy2-dashwin-actions">
          {meta && (
            <>
              <button onClick={() => setReloadNonce((n) => n + 1)} title="Neu laden">
                <IconRefresh size={13} />
              </button>
              <a href={meta.path} target="_blank" rel="noreferrer" title="In neuem Tab öffnen">
                <IconLink size={13} />
              </a>
            </>
          )}
          <button onClick={onClose} title="Schließen">
            <IconX size={14} />
          </button>
        </div>
      </header>
      <div className="emmy2-dashwin-body">
        {metaError && <p className="empty-hint">Programm ist nicht konfiguriert oder nicht erreichbar.</p>}
        {!metaError && !meta && <p className="empty-hint">Lädt…</p>}
        {meta && (
          <iframe
            key={reloadNonce}
            className="emmy2-dashwin-frame"
            src={meta.path}
            title={meta.title}
            style={{ pointerEvents: dragging ? "none" : "auto" }}
          />
        )}
      </div>
      <div className="emmy2-topicwin-resize" onPointerDown={start("resize")} />
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
            <kbd>[X]</kbd>
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
  const bodyRef = useRef<HTMLDivElement>(null);
  return (
    <div className="home-modal-backdrop" onClick={onClose}>
      <div className="emmy2-doc-panel" onClick={(e) => e.stopPropagation()}>
        <header className="emmy2-doc-head">
          <h3>{chatTitle}</h3>
          <div className="emmy2-doc-actions">
            <button onClick={() => downloadAsMarkdown(message.text, downloadFilenameFor(chatTitle, message.at))}>
              Herunterladen (.md)
            </button>
            <button onClick={() => bodyRef.current && printAsPdf(chatTitle, bodyRef.current.innerHTML)}>
              Als PDF exportieren
            </button>
            <button onClick={onClose} title="Schließen">
              <kbd>[X]</kbd>
            </button>
          </div>
        </header>
        <div ref={bodyRef} className="emmy2-doc-body emmy2-markdown">
          {renderMiniMarkdown(message.text)}
        </div>
      </div>
    </div>
  );
}
