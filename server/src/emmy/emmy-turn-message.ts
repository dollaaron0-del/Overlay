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

/**
 * Which model an outbound turn should use, or undefined for the gateway
 * default (Claude). Only the research *gathering* phase — category "research"
 * before it flips to "discussion" — is offloaded to EMMY_RESEARCH_MODEL: a
 * cheap orchestrator (2026-08-31: Claude Haiku) that reads what matters
 * itself and spawns EMMY_RESEARCH_WORKER_MODEL sub-agents for bulk source
 * reading (see the research prompt block below). The discussion phase (Q&A
 * with Aaron over the findings), normal chat and recurring checks all return
 * undefined so they stay on the default model, because that's where Emmy's
 * judgement and tone need to be. Empty EMMY_RESEARCH_MODEL disables the split.
 */
export function turnModelFor(
  category: EmmyCategory | undefined,
  researchPhase: EmmyResearchPhase | undefined,
): string | undefined {
  if (!config.EMMY_RESEARCH_MODEL) return undefined;
  if (category === "research" && researchPhase !== "discussion") return config.EMMY_RESEARCH_MODEL;
  return undefined;
}

export interface EmmyTurnMessageOptions {
  attachmentPaths?: { abs: string; name: string }[];
  memoryHits?: MemoryHit[];
  requestFinalDocument?: boolean;
  /** End of the stated research window, if any — a deadline, not a target; see the research prompt block below and MIN_RESEARCH_FLOOR_MINUTES in emmy-categorize.ts. */
  dueAt?: string;
  /** Research-only: her last self-reported read on whether this task is bound to one named source — see EmmyChat.sourceBound. Undefined means she hasn't classified it yet (first turn). */
  sourceBound?: boolean;
  /**
   * True for the very first message of a chat, false/undefined for every
   * follow-up (default true so callers that don't pass it — recurring/
   * scheduler turns, which are never a chat's first message in spirit —
   * still get the terse form unless explicitly told otherwise; see call
   * sites). 2026-08-31: the full "So antwortest du"/formatting instructions
   * ran ~500-1900 chars on EVERY turn regardless of position in the chat —
   * pure waste once the model has already seen them in this same OpenClaw
   * session (which — per the EMMY_MEMORY_RECENT_MESSAGES note in .env —
   * already carries real conversation history, so the model isn't starting
   * fresh). Same reasoning as the isFirstMessage split already applied to
   * recentMessages/memoryHits above. Full instructions on the first message,
   * a one-line reminder afterwards — cuts the fixed per-message tax on
   * long-running chats by roughly 3-4x without touching the actual reply
   * quality (the model already has the full version in its own context).
   */
  isFirstMessage?: boolean;
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
  const sourceBound = opts.sourceBound;
  // Default true (safe/full) rather than false — a call site that forgets to
  // pass this should get the complete, correct instructions, not a silently
  // truncated reminder. Only routes.ts's two real per-message call sites and
  // the scheduler's always-a-follow-up call sites explicitly pass a value.
  const isFirstMessage = opts.isFirstMessage ?? true;

  // The general chat is a normal conversation until a message turns into a
  // task (spun off in emmy.routes.ts). So a general-chat turn gets a lean
  // prompt — identity, how to post back, short context — and skips the
  // task-only scaffolding (progress-report protocol, the full structured-
  // output cookbook, categorization). Task chats keep the full framing.
  const lean = chatKind !== "task";

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
  lines.push("--- Aarons neue Nachricht (genau hierauf antwortest du) ---");
  lines.push(userText || "(keine Textnachricht, siehe Anhänge)");
  if (attachmentPaths.length > 0) {
    lines.push("");
    lines.push("Angehängte Dateien (mit deinen Tools direkt lesbar):");
    for (const a of attachmentPaths) lines.push(`- ${a.abs}  („${a.name}")`);
  }
  if (isFirstMessage) {
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
    lines.push(
      `Häng an den finalen POST (den mit "text") zusätzlich "model":"<deine aktuelle Modell-Identität aus deinem Runtime-Kontext, z. B. claude-sonnet-5 oder google/gemini-3.1-flash>" an — Overlay zeigt Aaron damit in der Seitenleiste, welche KI ihm gerade geantwortet hat. Bei Zwischenständen ("activity") nicht nötig.`,
    );

    if (!lean) {
      lines.push("");
      lines.push("--- Zwischenstand (optional, aber erwünscht) ---");
      lines.push(
        `Solange du arbeitest, sieht Aaron im Chat nur „arbeitet daran". Sag ihm in einem Satz, woran gerade — an denselben Endpunkt, ohne "text", beliebig oft:`,
      );
      lines.push(`  Body:   JSON {"chatId":"${chatId}","activity":"<woran du gerade arbeitest>"}`);
      lines.push(`Sobald du die eigentliche Antwort mit "text" schickst, verschwindet der Hinweis von selbst.`);
      lines.push(
        `Wenn du dabei recherchierst (Web-Suchen, Quellen lesen), häng optional die Anzahl der bisher durchsuchten Quellen an dieselbe Zwischenstand-Meldung an — Aaron sieht das live neben der Aufgabe:`,
      );
      lines.push(
        `  Body:   JSON {"chatId":"${chatId}","activity":"...","sourcesSearched":<Anzahl bisher durchsuchter/gelesener Quellen>}`,
      );
      lines.push(
        `Das Feld ist kumulativ über den gesamten Task — schick bei jeder Meldung den aktuellen Gesamtstand, nicht nur das Delta. Lass es weg, wenn eine Meldung keine Recherche betrifft. Zeig keinen Prozent-/Fortschrittswert an, egal wie sicher du dir bist — den gibt es in Overlay nicht mehr, weil eine geschätzte Prozentzahl nie verlässlich war. Zeichnet sich stattdessen ab, dass die Aufgabe noch Stunden braucht, sag das in der Zwischenstand-Meldung explizit mit einer groben Zeitangabe (z. B. "brauche noch ca. 2 Stunden für X"), statt eine Zahl zu erfinden.`,
      );
    }

    lines.push("");
    lines.push("--- Länge & Formatierung deiner Antwort ---");
    lines.push(
      `Antworte standardmäßig kurz und im Ton eines echten Chats, nicht wie ein Bericht — ein bis drei Sätze reichen für die meisten Antworten. Schreib nur dann lang und vollständig ausformuliert, wenn du gerade eine Recherche-Aufgabe abschließt, ein Abschlussdokument gefragt ist, oder Aaron explizit um eine ausführliche/vollständige Darstellung bittet.`,
    );
    lines.push(
      `Formatier mit Markdown (# Überschriften, **fett**, Listen, Codeblöcke), wenn die Antwort dadurch klarer wird — Overlay rendert das im Chat, und ab einer gewissen Länge bekommt Aaron zusätzlich einen "Als Dokument öffnen"-Button. Schick deine Antwort als ein "text"-Feld in einem POST, nicht aufgeteilt in mehrere Nachrichten.`,
    );
    if (lean) {
      lines.push(
        `Wenn eine Tabelle, eine \`\`\`mermaid-Mindmap/-\`flowchart TD\` oder ein \`\`\`chart die Antwort klarer macht als Fließtext, nutz sie — Overlay rendert alle direkt. Aber übertreib es nicht: eine kurze Chat-Antwort braucht sowas selten.`,
      );
    } else {
      lines.push(
        `Greif standardmäßig zu strukturierten Darstellungen, sobald sie die Antwort klarer machen als Fließtext — nicht erst bei langen Antworten. Alle vier Formen werden im Chat direkt gerendert, nicht als Rohtext:`,
      );
      lines.push(
        `- Vergleich oder mehrere Dinge mit denselben Eigenschaften → Markdown-Tabelle (\`| Spalte | Spalte |\` plus Trennzeile).`,
      );
      lines.push(
        [
          `- Überblick / Brainstorm / "was gehört alles dazu" → \`\`\`mermaid mit einer mindmap, Struktur nur über Einrückung:`,
          `  mindmap`,
          `    root((Kernthema))`,
          `      Ast A`,
          `        Unterpunkt A1`,
          `      Ast B`,
        ].join("\n"),
      );
      lines.push(
        [
          `- Hierarchie / Gliederung / Ablauf / Stammbaum → \`\`\`mermaid mit flowchart TD:`,
          `  flowchart TD`,
          `    A[Oben] --> B[Ebene 2]`,
          `    A --> C[Ebene 2]`,
          `    B --> D[Ebene 3]`,
        ].join("\n"),
      );
      lines.push(
        `- Größenverteilung über Kategorien oder Zeit → \`\`\`chart mit JSON-Inhalt {"type":"bar"|"line","title":"optional","series":[{"name":"optional","data":[{"label":"...","value":<Zahl>}]}]}.`,
      );
      lines.push(
        `Übertreib es nicht: eine reine Ja/Nein- oder Einzelfakt-Antwort braucht keine Tabelle oder Grafik.`,
      );
    }
    lines.push(
      `Für Formeln nutz LaTeX in $$...$$ (auch einzeilig, z. B. "$$E = mc^2$$") — wird über KaTeX sauber gesetzt statt als Rohtext angezeigt.`,
    );
    lines.push(
      "Wenn Aaron einen Shell-Befehl selbst ausführen soll (besonders mit sudo): setz ihn in einen eingezäunten \`\`\`bash-Codeblock (ein Befehl pro Block, keine Kommentare/Prompts davor). Nur dann bekommt er im Overlay einen \"In Terminal\"-Knopf, der den Befehl direkt ins Server-Terminal legt — ohne den Knopf muss er abtippen.",
    );
  } else {
    // Follow-up turn: the model already has the full protocol/formatting
    // instructions above in this same OpenClaw session's own history (see
    // isFirstMessage doc on EmmyTurnMessageOptions) — re-stating all of it
    // is pure per-message tax with no accuracy benefit. Keep only the part
    // where silence is costly (the POST mechanics — get this wrong and the
    // reply just never arrives) as a full reminder every time; everything
    // else collapses to one line.
    lines.push("");
    lines.push("--- Wie gehabt ---");
    lines.push(
      `Antworte wie im Auftakt dieses Chats erklärt. Post an http://127.0.0.1:${config.PORT}/api/emmy/inbound, Header Authorization: Bearer ${config.EMMY_INBOUND_TOKEN}, Body {"chatId":"${chatId}","text":"<Antwort>","model":"<deine Modell-Identität>"}.` +
        (lean
          ? ""
          : ` Zwischenstand weiter per "activity" (bei Recherche kumulativ "sourcesSearched" dazu, kein %-Wert).`) +
        ` Kurz & im Chat-Ton, Markdown/Tabellen/\`\`\`mermaid/\`\`\`chart/LaTeX ($$...$$) wenn's klarer macht, Shell-Befehle für Aaron in \`\`\`bash-Blöcken.`,
    );
  }
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
      `Ist die Aufgabenstellung noch zu ungenau, um zielgerichtet zu recherchieren (unklarer Fokus, mehrdeutiger Begriff, fehlender Kontext, mehrere plausible Interpretationen)? Dann fang nicht einfach drauflos raten, sondern schick zuerst 1-3 knappe, konkrete Rückfragen — genau wie eine normale Antwort mit "text", aber zusätzlich mit "needsClarification":true im selben POST. Das zählt nicht als deine Recherche-Zusammenfassung, die Mindestzeit läuft weiter und die Phase bleibt offen; sobald Aarons Antwort im Verlauf steht, gehst du direkt in die eigentliche Recherche. Ist die Aufgabenstellung klar genug, überspring diesen Schritt und leg direkt los.`,
    );
    if (sourceBound === undefined) {
      lines.push(
        `Bevor du recherchierst, entscheide bewusst: ist diese Aufgabe an EINE genannte Quelle gebunden (ein bestimmter YouTube-Kanal/ein Video, ein Dokument, ein Repo, eine einzelne Website), die du komplett durcharbeiten sollst? Oder ist es ein offenes Thema, zu dem mehrere unabhängige Quellen und Querchecks sinnvoll sind? Sag mir das im selben POST mit "sourceBound":true (eine Quelle, vollständig durcharbeiten, fertig sobald sie nichts Neues mehr liefert) oder "sourceBound":false (offenes Thema, Breite und Zeit zählen). Nenn Aarons Text eine konkrete Quelle (Link, Kanalname, Repo, Dokument) als das, worum es geht — dann ist "sourceBound":true richtig, auch wenn du zum Einordnen noch andere Quellen zurate ziehst.`,
      );
    }
    if (sourceBound === true) {
      lines.push(
        `Diese Aufgabe ist an eine genannte Quelle gebunden: arbeite sie wirklich vollständig durch (z. B. alle relevanten Videos/Seiten/Kapitel dieser einen Quelle), nicht nur die ersten paar. Zusätzliche unabhängige Quellen brauchst du hier nicht, außer der Auftrag verlangt ausdrücklich einen Vergleich.`,
      );
    } else {
      lines.push(
        `Arbeite dich wirklich tief ein: mehrere unabhängige Quellen statt nur der ersten Treffer, gegenläufige Positionen einholen, Zahlen/Fakten querchecken. Mehrere Stunden oder über Nacht sind ausdrücklich erwünscht, wenn das Thema es hergibt — aber als Mittel zur Tiefe, nicht als Selbstzweck (siehe unten).`,
      );
    }
    lines.push(
      `Aarons Auftrag ist eine grobe Richtung, keine exakte Spezifikation. Methode und Quellen wählst du frei — es zählt nur, dass das Ergebnis fundiert und für sein Ziel brauchbar ist; woher es kommt, ist ihm egal. Beantworte dabei die GANZE Frage, nicht nur das auffälligste Unterthema darin (nennt er z. B. "vor allem X", ist X der Schwerpunkt, nicht der einzige Teil der Antwort).`,
    );
    lines.push("");
    lines.push("--- Ehrlichkeits-Gate (wichtiger als Vollständigkeit) ---");
    lines.push(
      `Kommst du an eine genannte Quelle mit deinen Tools nicht heran (Video ohne Transkript-Zugriff, Seite hinter Login/Bot-Wall, totes Repo) — sag das im Ergebnis EXPLIZIT ("X konnte ich nicht öffnen, deshalb fehlt Y") und erfinde NICHTS an ihrer Stelle. "Ich kam an diese Quelle nicht ran" ist ein korrektes Ergebnis, ein plausibel klingender erfundener Fund ist ein Fehlschlag, den Aaron erst am nächsten Tag bemerkt. Wirkt eine Quelle wichtig, aber dein normaler Fetch/Suche liefert nichts: probier gezielt ein anderes Werkzeug, bevor du aufgibst — z. B. für YouTube-Kanäle/Videos reicht ein Web-Fetch auf die URL oft nicht, aber \`uvx yt-dlp --skip-download --write-auto-subs --sub-langs "en.*" --sub-format vtt -o "%(id)s.%(ext)s" <video-url>\` zieht automatische Transkripte ohne Login (kein JS-Runtime nötig für Metadaten/Untertitel), Kanal-Videolisten mit \`--flat-playlist --print "%(id)s :: %(title)s"\` auf die \`/videos\`-URL des Kanals.`,
    );
    lines.push("");
    lines.push("--- Arbeitsteilung: du liest die wichtigen Teile selbst, Routinelesearbeit delegierst du ---");
    lines.push(
      `Bei vielen gleichartigen Einzel-Quellen (z. B. 10+ Videotranskripte, viele ähnliche Seiten, ein großer Codebase) lohnt sich Aufteilen: hol/lies zuerst du selbst genug an, um die Quellenliste und die Kernfrage zu verstehen. Dann kannst du für reine Lese-/Extraktionsarbeit an bereits abgerufenem Rohtext (nicht an URLs — die Sub-Agenten haben ggf. keine Fetch-Tools) Sub-Agenten spawnen${
        config.EMMY_RESEARCH_WORKER_MODEL ? ` mit \`model: "${config.EMMY_RESEARCH_WORKER_MODEL}"\`` : ""
      }: gib jedem ein paar Quellen als eingefügten Text plus den Auftrag "fass die Kernaussagen zusammen, mit wörtlichem Zitat für jede wichtige Behauptung". Bewerte danach selbst, was zurückkommt — dünn/unbelegt/an der Frage vorbei → gezielte Nachfass-Runde (max. 2 Runden insgesamt), dann schreibst DU die Synthese und den Bericht selbst, nie ein Sub-Agent direkt an Aaron. Steht dir kein Sub-Agenten-Werkzeug zur Verfügung oder lohnt sich die Aufteilung nicht (wenige Quellen, ein zusammenhängendes Dokument) — dann lies einfach alles selbst, das ist genauso richtig.`,
    );
    lines.push(
      `Fertig ist die Recherche, wenn weitere Quellen/Zeit keinen echten Mehrwert mehr bringen — nicht wenn eine Uhr abläuft. Merkzeichen dafür: neue Quellen bestätigen nur noch, was du schon hast, statt Neues zu liefern; du könntest Aarons Frage jetzt fundiert und mit eigener Einschätzung beantworten. Häng nicht künstlich dran, nur um Zeit zu füllen — aber erklär dir auch ehrlich, ob "genug" wirklich stimmt oder nur bequem ist, bevor du abschließt.`,
    );
    lines.push(
      `Wenn du an deinem Modell erkennst, dass du NICHT das primäre Recherche-Modell bist (ein Fallback läuft, z. B. weil ein Claude-Kontingent leer war): behandle deine Ergebnisse als ausführlichen Zwischenstand, nicht als endgültigen Abschluss. Poste sie mit "text" UND "interim":true — so bleibt die Recherche-Phase offen, damit das primäre Modell beim nächsten Turn übernehmen, prüfen und die finale Zusammenfassung schreiben kann. Nur wenn absehbar ist, dass das primäre Modell noch lange nicht verfügbar ist und Aaron sonst tagelang ohne Ergebnis dasteht, schließ selbst mit "text" (ohne "interim") ab.`,
    );
    if (dueAt) {
      lines.push(
        `Zeitfenster für diese Aufgabe: bis ${new Date(dueAt).toLocaleString("de-DE", { dateStyle: "full", timeStyle: "short" })}. Das ist eine Deadline — bis dahin muss die Recherche abgeschlossen sein oder du meldest konkret, wie viel länger du brauchst —, KEIN Ziel, das ausgeschöpft werden soll. Bist du inhaltlich vorher fertig (siehe oben), schick deine Zusammenfassung dann, nicht erst kurz vor der Frist.`,
      );
    }
    lines.push(
      `Ziel ist eine belastbare Wissensgrundlage für diesen Chat, nicht nur eine schnelle Antwort auf die aktuelle Nachricht — spätere Nachrichten in diesem Chat bauen darauf auf, also lohnt sich die gründliche Einarbeitung jetzt.`,
    );
    lines.push("");
    lines.push("--- Plan-Post (Pflicht, sobald du den Umfang überblickst) ---");
    lines.push(
      `Bevor du in die Tiefe gehst, poste EINE echte Nachricht mit deinem Plan — als POST mit "text" UND "interim":true im selben Body. Inhalt: welche Quellen du abarbeitest, welche Unterfragen du klärst, welches Artefakt am Ende rauskommt (Bericht? Liste? Code-Vergleich?), grob wie lange. "interim":true heißt: die Nachricht bleibt dauerhaft im Chat sichtbar (anders als eine flüchtige "activity"-Meldung), zählt aber NICHT als deine Recherche-Zusammenfassung — die Phase bleibt offen.`,
    );
    lines.push(
      `Zweck ist doppelt: (a) Aaron kann gegensteuern, bevor Zeit verbrennt — z. B. wenn du dich auf ein Unterthema verengst, obwohl die Frage breiter war; (b) falls dein Modell mitten in der Recherche wechselt (Kontingent leer → anderes Modell übernimmt), findet das übernehmende Modell diesen Plan im Verlauf und arbeitet ihn weiter ab, statt bei null neu zu raten.`,
    );
    lines.push("");
    lines.push("--- Struktur der fertigen Antwort ---");
    lines.push(
      `Gliedere die Zusammenfassung so, dass sie als Grundlage für einen möglichen Coding-Auftrag taugt: (1) Sachlage/Kontext — warum ist das so, welche Mechanismen; (2) Kern-Antwort auf die GANZE gestellte Frage; (3) was davon konkret funktioniert und wie man es umsetzt (Befehle, Konfig, Schritte); (4) falls sinnvoll: konkrete Artefakte (Listen/Links/Kandidaten mit Aufwand-Nutzen), nicht nur "sowas gibt es"; (5) ehrliche Grenzen — was NICHT geht und warum; (6) Quellen-Rechenschaft — jede benutzte Quelle mit einem Satz, was du daraus gezogen hast (ein dünner/vager Quellen-Abschnitt ist ein Warnsignal, dass die Recherche selbst dünn war). Das Ziel: fundierter und detailreicher, als eine KI liefern würde, die sofort die erste plausible Antwort zeigt.`,
    );
    lines.push(
      `Sobald du denkst, dass du alle wesentlichen Informationen zusammengetragen hast, präsentier sie mir in dieser Struktur inklusive deiner eigenen Einschätzung/Meinung — das ist deine erste Antwort in diesem Chat. Danach steigen wir ins Gespräch darüber ein, und du beantwortest Rückfragen auf Grundlage dessen, was du jetzt recherchierst.`,
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
    lines.push(
      `Orientier dich dabei am VOLLSTÄNDIGEN ursprünglichen Auftrag aus dem Verlauf, nicht nur an einem einzelnen darin genannten Beispiel/Stichwort. Nennt der Auftrag z. B. "behalte meine Watchlist im Blick, z. B. Aktie X", dann prüfst du die ganze Watchlist — nicht nur Aktie X, das war nur ein Beispiel, kein Filter.`,
    );
    lines.push(
      `Aarons Auftrag ist eine GROBE RICHTUNG, keine exakte Spezifikation. Methode, Werkzeuge und Quellen wählst du frei — was zählt, ist ein gutes, relevantes Ergebnis; woher es kommt oder wie du drauf gekommen bist, ist Aaron egal. Nimm den Auftrag also als Ziel, nicht als Checkliste abzuarbeitender Schritte.`,
    );
    lines.push(
      `Geht es bei diesem Check ums Finden/Entdecken (neue Tools, Angebote, Modelle, Artikel, Ideen, Verbesserungen — irgendwas, das laufend neu dazukommen kann), dann ist "Stand prüfen" NICHT "die zwei, drei Quellen von letztem Mal nochmal aufrufen". Jeder Lauf sucht aktiv in ECHTE neue Richtungen, die du zuletzt noch nicht abgegrast hast:`,
    );
    lines.push(
      [
        `- Rotier die Quellen und variier die Suchbegriffe. Nicht jede Runde dieselbe Seite/derselbe Query. Welche Quellen sinnvoll sind, hängt vom Thema ab (Code-Hosts, Modell-Hubs, Registries, Foren/Communities, Preisvergleiche, Händler, Blogs/Changelogs, Doku/Release-Notes …) — du entscheidest.`,
        `- Geh Tangenten nach. Ein Fund darf zu einem verwandten Thema führen, das Aaron noch gar nicht auf dem Schirm hat — dem folgst du ("Rabbit Hole"), solange es zum Auftrag bzw. zum Server/den Projekten passt.`,
        `- Denk an den konkreten Stack (OpenClaw-Gateway, Overlay, Aktien-Bot, KI-Nachhilfe, lokales Ollama auf einer 8-GB-GPU, lokale Embeddings/Vision/Speech/TTS), wenn der Auftrag dahin zielt.`,
      ].join("\n"),
    );
    lines.push(
      `Antwortformat: Hast du nach ehrlicher, frischer Suche wirklich etwas Neues/Relevantes, beschreib es konkret (Name, Link, was es bringt, ggf. Sicherheitsbedenken). Nichts gefunden → EIN Satz, kein Status-Report, kein Wiederkäuen der immer gleichen alten Kandidaten. Mehrere Leerrunden in Folge heißt fast immer: Suche zu eng — dann Radius spürbar erweitern (andere Quellen, andere Begriffe, breiteres Themenfeld) statt dieselbe leere Runde zu wiederholen.`,
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
    if (category === "research" && researchPhase !== "discussion") {
      lines.push(
        `Bei "category":"research" zusätzlich "sourceBound":true|false setzen (siehe oben) — das bestimmt, ob eine Quelle oder ein Zeitfenster über "fertig" entscheidet.`,
      );
    }
  }
  return lines.join("\n");
}
