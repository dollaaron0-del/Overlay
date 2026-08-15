import { config } from "../config.js";
import type { EmmyCategory, EmmyMessage, EmmyResearchPhase } from "@overlay/shared";
import { truncateForPrompt, type MemoryHit } from "./emmy-memory.js";

// Emmy's replies can run up to 300,000 chars for a full report
// (emmy-inbound.routes.ts's schema) — without truncation, replaying ten
// recent messages plus six memory hits verbatim into every new turn's prompt
// could balloon far past what's reasonable to resend on each message.
const PROMPT_LINE_MAX_CHARS = 500;

/** OpenClaw session key for a chat's isolated agent context — see openclaw-webhook.ts. */
export function sessionKeyFor(chatId: string): string {
  return `agent:main:overlay:${chatId}`;
}

export interface EmmyTurnMessageOptions {
  attachmentPaths?: { abs: string; name: string }[];
  memoryHits?: MemoryHit[];
  requestFinalDocument?: boolean;
  /** End of the stated research window, if any — see minResearchDurationMs in emmy-categorize.ts. */
  dueAt?: string;
}

/**
 * Builds the prompt for an isolated OpenClaw agent turn. It carries
 * everything the turn needs to answer AND to post its reply back into the
 * right chat — the inbound token is included here because the agent process
 * runs as `aaron`, which cannot read Overlay's root-owned .env itself.
 *
 * Shared by every path that starts a turn: a manual message from Aaron
 * (emmy.routes.ts) and an automatic recurring-tasks check (emmy-scheduler.ts)
 * — both call this same function so there is exactly one "So antwortest
 * du"/formatting template to keep in sync, not two drifting copies.
 */
export function buildEmmyTurnMessage(
  chatTitle: string,
  chatKind: string,
  chatId: string,
  userText: string,
  recentMessages: EmmyMessage[],
  category: EmmyCategory | undefined,
  researchPhase: EmmyResearchPhase | undefined,
  opts: EmmyTurnMessageOptions = {},
): string {
  const attachmentPaths = opts.attachmentPaths ?? [];
  const memoryHits = opts.memoryHits ?? [];
  const requestFinalDocument = opts.requestFinalDocument === true;
  const dueAt = opts.dueAt;

  const lines: string[] = [];
  const context = chatKind === "task" ? `zur Aufgabe „${chatTitle}"` : "im allgemeinen Chat";
  lines.push(`[Overlay] Nachricht von Aaron ${context}:`);

  if (recentMessages.length > 0) {
    lines.push("");
    lines.push("--- Bisheriger Verlauf in diesem Chat ---");
    for (const m of recentMessages) {
      lines.push(`${m.role === "me" ? "Aaron" : "Emmy"}: ${truncateForPrompt(m.text, PROMPT_LINE_MAX_CHARS)}`);
    }
  }

  if (memoryHits.length > 0) {
    lines.push("");
    lines.push("--- Möglicherweise relevante frühere Gespräche (auch aus anderen/gelöschten Chats) ---");
    for (const hit of memoryHits) {
      const when = new Date(hit.at).toLocaleString("de-DE");
      lines.push(`[${hit.chatTitle}, ${when}] ${truncateForPrompt(hit.snippet, PROMPT_LINE_MAX_CHARS)}`);
    }
  }

  lines.push("");
  lines.push(userText || "(keine Textnachricht, siehe Anhänge)");
  if (attachmentPaths.length > 0) {
    lines.push("");
    lines.push("Angehängte Dateien (mit deinen Tools direkt lesbar):");
    for (const a of attachmentPaths) lines.push(`- ${a.abs}  („${a.name}")`);
  }
  lines.push("");
  lines.push("--- So antwortest du ---");
  lines.push(
    `Beantworte das als Emmy auf Deutsch. Deine Antwort erscheint NUR dann im Overlay-Chat, wenn du sie an diesen Endpunkt zurückschickst (genau ein POST):`,
  );
  lines.push(`  URL:    http://127.0.0.1:${config.PORT}/api/emmy/inbound`);
  lines.push(`  Header: Authorization: Bearer ${config.EMMY_INBOUND_TOKEN}`);
  lines.push(`  Body:   JSON {"chatId":"${chatId}","text":"<deine vollständige Antwort>"}`);
  lines.push(
    `Tipp: Schreib die JSON-Payload in eine temporäre Datei und sende sie mit "curl --data @datei", um Quoting-Probleme zu vermeiden. Sende deine Antwort nur einmal.`,
  );
  lines.push("");
  lines.push("--- Zwischenstand (optional, aber erwünscht) ---");
  lines.push(
    `Solange du arbeitest, sieht Aaron im Chat nur „arbeitet daran". Sag ihm in einem Satz, woran gerade — an denselben Endpunkt, ohne "text", beliebig oft:`,
  );
  lines.push(`  Body:   JSON {"chatId":"${chatId}","activity":"<woran du gerade arbeitest>"}`);
  lines.push(`Sobald du die eigentliche Antwort mit "text" schickst, verschwindet der Hinweis von selbst.`);
  lines.push(
    `Wenn du dabei recherchierst (Web-Suchen, Quellen lesen), häng optional deinen Fortschritt an dieselbe Zwischenstand-Meldung an — Aaron sieht das live als Quellenzähler und Wissensstand-Balken neben der Aufgabe:`,
  );
  lines.push(
    `  Body:   JSON {"chatId":"${chatId}","activity":"...","sourcesSearched":<Anzahl bisher durchsuchter/gelesener Quellen>,"knowledgeLevel":<0-100, deine ehrliche Einschätzung wie gut du das Thema jetzt kennst>}`,
  );
  lines.push(
    `Beide Felder sind kumulativ über den gesamten Task — schick bei jeder Meldung den aktuellen Gesamtstand, nicht nur das Delta. Lass sie weg, wenn eine Meldung keine Recherche betrifft.`,
  );
  lines.push("");
  lines.push("--- Länge & Formatierung deiner Antwort ---");
  lines.push(
    `Antworte standardmäßig kurz und im Ton eines echten Chats, nicht wie ein Bericht — ein bis drei Sätze reichen für die meisten Antworten. Schreib nur dann lang und vollständig ausformuliert, wenn du gerade eine Recherche-Aufgabe abschließt, ein Abschlussdokument gefragt ist, oder Aaron explizit um eine ausführliche/vollständige Darstellung bittet.`,
  );
  lines.push(
    `Formatier nur dann mit Markdown (# Überschriften, **fett**, Listen, Tabellen, Codeblöcke), wenn die Antwort tatsächlich lang ist — Overlay stellt das im Chat entsprechend dar, und ab einer gewissen Länge bekommt Aaron zusätzlich einen "Als Dokument öffnen"-Button. Schick deine Antwort als ein "text"-Feld in einem POST, nicht aufgeteilt in mehrere Nachrichten.`,
  );
  if (requestFinalDocument) {
    lines.push("");
    lines.push("--- Abschlussdokument gewünscht ---");
    lines.push(
      `Aaron möchte jetzt das Abschlussdokument zu dieser Aufgabe. Erstell ein ausführliches, vollständig ausformuliertes Markdown-Dokument mit allen Informationen aus deiner Recherche und der bisherigen Unterhaltung, die für die Aufgabenstellung relevant sind.`,
    );
    lines.push(
      `Leg dabei besonderen Fokus auf die Punkte, die im Gesprächsverlauf mit Aaron als wichtig hervorgingen — nicht nur auf deine ursprüngliche Recherche. Das ist der Abschluss dieser Aufgabe, also lieber zu vollständig als zu knapp.`,
    );
  } else if (category === "research" && researchPhase !== "discussion" && dueAt && new Date(dueAt).getTime() <= Date.now()) {
    lines.push("");
    lines.push("--- Status-Check: Dein Zeitfenster ist abgelaufen ---");
    lines.push(
      `Das für diese Recherche vereinbarte Zeitfenster endete bereits am ${new Date(dueAt).toLocaleString("de-DE", { dateStyle: "full", timeStyle: "short" })}. Aaron fragt jetzt nach dem Stand — antworte konkret auf genau eine der beiden folgenden Arten, nicht einfach mit einer weiteren Zwischenstand-Meldung ohne echte Antwort:`,
    );
    lines.push(
      `  1. Du brauchst noch mehr Zeit: Schick eine Zwischenstand-Meldung (activity, OHNE "text") und nenn darin konkret, woran es noch hängt und wie viel länger du ungefähr brauchst (grobe Schätzung reicht, z. B. "brauche noch ca. 2 Stunden für X"). Das zählt nicht als Abschluss, recherchier danach direkt weiter.`,
    );
    lines.push(
      `  2. Du hast das Wesentliche zusammen: Schick jetzt mit "text" die vollständige, ausführliche Zusammenfassung inklusive deiner eigenen Einschätzung — das ist dann der Abschluss der Recherche-Phase, danach steigen wir ins Gespräch darüber ein.`,
    );
  } else if (category === "research" && researchPhase !== "discussion") {
    lines.push("");
    lines.push("--- Das hier ist eine Recherche-Aufgabe ---");
    lines.push(
      `Nimm dir dafür so viel Zeit wie nötig — mehrere Stunden oder über Nacht sind ausdrücklich erwünscht, nicht nur erlaubt. Arbeite dich wirklich tief ein: mehrere unabhängige Quellen statt nur der ersten Treffer, gegenläufige Positionen einholen, Zahlen/Fakten querchecken. Hör nicht auf, sobald du "genug" zu haben glaubst — schick stattdessen weitere Zwischenstand-Meldungen (activity/sourcesSearched/knowledgeLevel) und recherchiere weiter, bis dein knowledgeLevel wirklich hoch ist.`,
    );
    if (dueAt) {
      lines.push(
        `Zeitfenster für diese Aufgabe: bis ${new Date(dueAt).toLocaleString("de-DE", { dateStyle: "full", timeStyle: "short" })}. Das ist keine Deadline zum Draufloslegen kurz davor, sondern der Rahmen, den du ausnutzen sollst — schick deine erste vollständige Zusammenfassung nicht viel früher als nötig, sondern erst wenn du das Fenster für echte Tiefe genutzt hast.`,
      );
      lines.push(
        `Kommt deine erste Zusammenfassung deutlich zu früh, wird sie NICHT als Abschluss gewertet: Overlay speichert sie als Zwischenstand und schickt dir automatisch einen neuen Auftrag, weiterzurecherchieren, bevor die Recherche-Phase endet.`,
      );
    }
    lines.push(
      `Ziel ist eine belastbare Wissensgrundlage für diesen Chat, nicht nur eine schnelle Antwort auf die aktuelle Nachricht — spätere Nachrichten in diesem Chat bauen darauf auf, also lohnt sich die gründliche Einarbeitung jetzt.`,
    );
    lines.push(
      `Sobald du denkst, dass du alle wesentlichen Informationen zusammengetragen hast, präsentier sie mir als ausführliche Zusammenfassung inklusive deiner eigenen Einschätzung/Meinung — das ist deine erste Antwort in diesem Chat. Danach steigen wir ins Gespräch darüber ein, und du beantwortest Rückfragen auf Grundlage dessen, was du jetzt recherchierst.`,
    );
  } else if (category === "research" && researchPhase === "discussion") {
    lines.push("");
    lines.push("--- Du bist in der Feedback-/Nachfragephase ---");
    lines.push(
      `Du hast in diesem Chat bereits ausführlich recherchiert (siehe Verlauf). Beantworte Aarons Fragen und Feedback auf Grundlage der bereits gesammelten Informationen, ohne bei jeder Nachfrage von vorn zu recherchieren.`,
    );
    lines.push(
      `Nur wenn eine Frage in eine Richtung geht, zu der deine bisherige Recherche dünn oder gar nicht vorhanden ist, mach vorher noch eine kurze, gezielte Nachrecherche (Minuten, keine Stunden) und beantworte dann die Frage.`,
    );
    lines.push(
      `Wenn dir das Gespräch so vorkommt, als wäre eigentlich alles Wichtige besprochen, schlag Aaron proaktiv vor, das Abschlussdokument erstellen zu lassen (dafür gibt es auch einen Button bei ihm im Chat) — aber dräng nicht, wenn er weiter nachfragen will.`,
    );
  } else if (category === "recurring") {
    lines.push("");
    lines.push("--- Das hier ist ein wiederkehrender Check ---");
    lines.push(
      `Diese Aufgabe wird automatisch in regelmäßigen Abständen erneut aufgerufen (siehe Verlauf für den ursprünglichen Auftrag). Prüf den aktuellen Stand und antworte kurz und konkret — nur was sich geändert hat oder worauf Aaron jetzt achten sollte, keine Wiederholung der kompletten Vorgeschichte.`,
    );
  }
  if (chatKind === "task") {
    lines.push("");
    lines.push("--- Einordnung (optional) ---");
    lines.push(
      `Overlay sortiert jede Aufgabe automatisch in eine von drei Kategorien. Liegt sie falsch, korrigier sie im selben POST:`,
    );
    lines.push(`  "category":"instant"   — sofort erledigen`);
    lines.push(`  "category":"research"  — tiefere Recherche, dazu "dueAt":"<ISO-Zeitpunkt>" als Ende des Zeitfensters`);
    lines.push(`  "category":"recurring" — wiederkehrender Check, dazu "intervalHours":<Zahl>`);
    lines.push(`Hat Aaron die Kategorie selbst gesetzt, wird deine Korrektur ignoriert — das ist so gewollt.`);
  }
  return lines.join("\n");
}
