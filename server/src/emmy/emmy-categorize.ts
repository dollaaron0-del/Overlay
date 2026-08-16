import type { EmmyCategory, EmmyChat } from "@overlay/shared";

/**
 * Sorts a new task chat into one of the three ways Aaron works with Emmy:
 *
 *   1. "instant"   — kurz, sofort erledigen
 *   2. "research"  — tiefere Recherche in einem Zeitfenster (-> dueAt)
 *   3. "recurring" — wiederkehrender Check einer Aufgabe (-> intervalHours)
 *
 * Deliberately a local keyword/date heuristic rather than an LLM call: it runs
 * on every chat creation and every first message, must be instant, must work
 * with Ollama down, and must be testable. It is only ever a first guess —
 * Emmy can correct it through /api/emmy/inbound and Aaron can override it in
 * the UI (which pins the category as "manual" so nothing re-guesses it).
 */

/** A monitoring verb with no cadence given ("behalte X im Auge") checks once a day. */
export const DEFAULT_INTERVAL_HOURS = 24;
/** Research with no deadline in the text gets a one-week window. */
export const DEFAULT_RESEARCH_WINDOW_HOURS = 24 * 7;

/**
 * How much of the stated research window ("bis heute Abend", "über Nacht", …)
 * Emmy must actually use before her first summary is accepted as ending the
 * deep-research phase. The prompt already asks her to take her time — this is
 * the hard floor under that ask, so a fast reply can't just skip past it (see
 * emmy-inbound.routes.ts).
 */
export const MIN_RESEARCH_FRACTION = 0.5;
/** Ceiling on that floor: a week-long default window shouldn't force days of
 * research, only enough to rule out a five-minute pass. */
export const MIN_RESEARCH_CAP_HOURS = 3;
/** Never require less than this, even for a very short explicit deadline. */
export const MIN_RESEARCH_FLOOR_MINUTES = 10;

/** The minimum time Emmy must spend before `windowMs` (dueAt - createdAt) counts as "done". */
export function minResearchDurationMs(windowMs: number): number {
  const capped = Math.min(windowMs * MIN_RESEARCH_FRACTION, MIN_RESEARCH_CAP_HOURS * 3_600_000);
  return Math.max(capped, MIN_RESEARCH_FLOOR_MINUTES * 60_000);
}

export interface EmmyClassification {
  category: EmmyCategory;
  /** Only set for "research". */
  dueAt?: string;
  /** Only set for "recurring". */
  intervalHours?: number;
}

const WEEKDAYS: Record<string, number> = {
  sonntag: 0,
  montag: 1,
  dienstag: 2,
  mittwoch: 3,
  donnerstag: 4,
  freitag: 5,
  samstag: 6,
  sonnabend: 6,
};

// Umlauts are non-word characters, so \b before "ü"/"ä"/"ö" never matches —
// those stems are matched as plain substrings instead.
const MONITOR_HINTS = [
  /überwach|ueberwach/,
  /beobachte/,
  // Verb-first ("behalte X im Auge") and verb-last ("X im Auge behalten") both occur.
  /\bim auge\b/,
  /\bim blick\b/,
  // Not a bare "Monitor" — that is a screen, not a job ("Kabel für den Monitor").
  /\bmonitoring\b/,
  /\bregelmä(ß|ss)ig/,
  /wiederkehrend/,
  /\bimmer wieder\b/,
  /\blaufend (prüfen|pruefen|checken|kontrollieren)/,
  /\bmeld dich, (wenn|sobald)\b/,
  /\bsag bescheid, (wenn|sobald)\b/,
];

const RESEARCH_HINTS = [
  /recherch/,
  /\bresearch/,
  /analysier|\banalyse\b|analysiere/,
  /vergleich/,
  /evaluier/,
  /untersuch/,
  /\bfind(e|)? (heraus|raus)\b/,
  /\bmarkt(übersicht|uebersicht|analyse|studie)?\b/,
  /\bstudie\b/,
  /\bdossier\b/,
  /\bkonzept\b/,
  /ausarbeit/,
  /\btiefe(r|re|n)? (recherche|analyse|blick)\b/,
  /\bdeep.?dive\b/,
  /(überblick|ueberblick)/,
  /\bbericht\b|\breport\b/,
  /\bpro und (contra|kontra)\b/,
  /\boptionen\b|\bmöglichkeiten\b|\bmoeglichkeiten\b/,
  /\bhintergr(und|ünde|uende)/,
  /\blies dich ein\b|einarbeit/,
  /\brecherchier/,
  /\bzusammenfass|\bfass .* zusammen\b/,
];

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((re) => re.test(text));
}

function endOfDay(date: Date): Date {
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return end;
}

function addDays(from: Date, days: number): Date {
  const next = new Date(from);
  next.setDate(next.getDate() + days);
  return next;
}

/** Hours for "alle N <einheit>"; undefined when the text has no explicit "alle …" cadence. */
function everyNHours(text: string): number | undefined {
  const match = text.match(
    /\balle[nrm]?\s+(\d{1,3})\s*(minuten|minute|min|stunden|stunde|std|tagen|tage|tag|wochen|woche|monaten|monate|monat)\b/,
  );
  if (!match) return undefined;
  const count = Number(match[1]);
  if (count <= 0) return undefined;
  const unit = match[2];
  if (unit.startsWith("min")) return Math.round((count / 60) * 100) / 100;
  if (unit.startsWith("stunde") || unit === "std") return count;
  if (unit.startsWith("tag")) return count * 24;
  if (unit.startsWith("woche")) return count * 24 * 7;
  return count * 24 * 30;
}

const FIXED_CADENCES: { re: RegExp; hours: number }[] = [
  { re: /(stündlich|stuendlich)|\bjede stunde\b/, hours: 1 },
  { re: /(täglich|taeglich)|\bjeden tag\b|\bjeden (morgen|vormittag|mittag|nachmittag|abend)\b/, hours: 24 },
  { re: /(wöchentlich|woechentlich)|\bjede woche\b|\bjeden (montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonnabend|sonntag)\b/, hours: 24 * 7 },
  { re: /\bmonatlich\b|\bjeden monat\b/, hours: 24 * 30 },
];

/** The cadence a "recurring" task should be checked at, if the text states one. */
export function detectIntervalHours(text: string): number | undefined {
  const explicit = everyNHours(text);
  if (explicit !== undefined) return explicit;
  for (const { re, hours } of FIXED_CADENCES) {
    if (re.test(text)) return hours;
  }
  return undefined;
}

/**
 * The end of the time window stated in the text ("bis Freitag", "in 3 Tagen",
 * "diese Woche", "bis 12.09."). Day-granular windows end at 23:59 local time,
 * hour-granular ones at the exact instant.
 */
export function detectDueAt(text: string, now: Date): Date | undefined {
  const relative = text.match(
    /\b(in|innerhalb von|binnen)\s+(\d{1,3})\s*(minuten|minute|stunden|stunde|std|tagen|tage|tag|wochen|woche|monaten|monate|monat)\b/,
  );
  if (relative) {
    const count = Number(relative[2]);
    const unit = relative[3];
    if (unit.startsWith("min")) return new Date(now.getTime() + count * 60_000);
    if (unit.startsWith("stunde") || unit === "std") return new Date(now.getTime() + count * 3_600_000);
    if (unit.startsWith("tag")) return endOfDay(addDays(now, count));
    if (unit.startsWith("woche")) return endOfDay(addDays(now, count * 7));
    return endOfDay(addDays(now, count * 30));
  }

  // Explicit calendar dates: 12.09., 12.09.2026, 2026-09-12.
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const parsed = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    if (!Number.isNaN(parsed.getTime())) return endOfDay(parsed);
  }
  const german = text.match(/\b(\d{1,2})\.\s?(\d{1,2})\.(\d{4})?/);
  if (german) {
    const day = Number(german[1]);
    const month = Number(german[2]) - 1;
    const year = german[3] ? Number(german[3]) : now.getFullYear();
    let parsed = new Date(year, month, day);
    // A bare "12.09." that already passed this year means next year.
    if (!german[3] && parsed.getTime() < now.getTime()) parsed = new Date(year + 1, month, day);
    if (!Number.isNaN(parsed.getTime()) && parsed.getMonth() === month) return endOfDay(parsed);
  }

  // "über Nacht" — done by tomorrow morning, not just "sometime tomorrow".
  if (/(über nacht|ueber nacht|\bovernight\b)/.test(text)) {
    const next = addDays(now, 1);
    next.setHours(8, 0, 0, 0);
    return next;
  }
  if (/(übermorgen|uebermorgen)/.test(text)) return endOfDay(addDays(now, 2));
  if (/\bmorgen\b/.test(text) && !/\bjeden morgen\b/.test(text)) return endOfDay(addDays(now, 1));
  if (/\bheute\b|\bbis heute abend\b/.test(text)) return endOfDay(now);
  if (/(nächste|naechste|kommende) woche/.test(text)) {
    // End of next week: the Sunday after the coming one.
    const toSunday = (7 - now.getDay()) % 7;
    return endOfDay(addDays(now, toSunday + 7));
  }
  if (/\bdiese woche\b|\bbis (zum )?wochenende\b/.test(text)) {
    const toSunday = (7 - now.getDay()) % 7;
    return endOfDay(addDays(now, toSunday === 0 ? 0 : toSunday));
  }
  if (/\b(bis )?(zum )?(ende des monats|monatsende)\b/.test(text)) {
    return endOfDay(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  }

  // "bis Freitag" / "am Freitag" — the next occurrence, today included.
  const weekday = text.match(
    /\b(bis|am|bis zum|nächsten|naechsten|kommenden)\s+(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonnabend|sonntag)\b/,
  );
  if (weekday) {
    const target = WEEKDAYS[weekday[2]];
    const delta = (target - now.getDay() + 7) % 7;
    return endOfDay(addDays(now, delta));
  }
  return undefined;
}

/**
 * Classifies free text (a task title, optionally plus its first message).
 * Recurrence wins over research: "recherchiere jede Woche X" is a repeating
 * check whose single run happens to be research, and treating it as a one-off
 * research task would silently drop the repetition.
 */
export function classifyTask(text: string, now: Date = new Date()): EmmyClassification {
  const normalized = text.toLowerCase();

  const interval = detectIntervalHours(normalized);
  if (interval !== undefined) {
    return { category: "recurring", intervalHours: interval };
  }
  if (matchesAny(normalized, MONITOR_HINTS)) {
    return { category: "recurring", intervalHours: DEFAULT_INTERVAL_HOURS };
  }
  if (matchesAny(normalized, RESEARCH_HINTS)) {
    const due = detectDueAt(normalized, now) ?? new Date(now.getTime() + DEFAULT_RESEARCH_WINDOW_HOURS * 3_600_000);
    return { category: "research", dueAt: due.toISOString() };
  }
  return { category: "instant" };
}

/**
 * The schedule fields that go with a category, whether picked by Aaron in
 * the UI or corrected by Emmy herself via /api/emmy/inbound. Explicit values
 * always win; `undefined` falls back to the existing chat's value (or the
 * category's default). Each category is defined by its schedule field, so
 * switching into one fills the missing field and switching out clears both —
 * a "sofort" task must not keep a stale deadline or interval lying around.
 */
export function defaultsForCategory(
  category: EmmyCategory | undefined,
  existing: EmmyChat | undefined,
  dueAt: string | null | undefined,
  intervalHours: number | null | undefined,
): { dueAt?: string | null; intervalHours?: number | null } {
  if (category === undefined) return { dueAt, intervalHours };
  if (category === "research") {
    return {
      dueAt: dueAt ?? existing?.dueAt ?? new Date(Date.now() + DEFAULT_RESEARCH_WINDOW_HOURS * 3_600_000).toISOString(),
      intervalHours: null,
    };
  }
  if (category === "recurring") {
    return { dueAt: null, intervalHours: intervalHours ?? existing?.intervalHours ?? DEFAULT_INTERVAL_HOURS };
  }
  return { dueAt: null, intervalHours: null };
}
