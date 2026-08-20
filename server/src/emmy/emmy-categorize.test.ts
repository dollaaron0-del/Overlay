import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyTask,
  detectDueAt,
  detectIntervalHours,
  minResearchDurationMs,
  DEFAULT_INTERVAL_HOURS,
} from "./emmy-categorize.js";

// A fixed Monday so weekday and week-window maths stay deterministic.
const MONDAY = new Date(2026, 7, 10, 9, 0, 0); // 2026-08-10, a Monday

test("plain short jobs land in 'instant'", () => {
  for (const text of [
    "Rechnung an Meier schreiben",
    "Kurz die Logs vom Backup anschauen",
    "Wie heißt das Kabel für den Monitor?",
  ]) {
    assert.equal(classifyTask(text, MONDAY).category, "instant", text);
  }
});

test("an instant task carries neither a window nor an interval", () => {
  const result = classifyTask("Rechnung an Meier schreiben", MONDAY);
  assert.equal(result.dueAt, undefined);
  assert.equal(result.intervalHours, undefined);
});

test("research wording lands in 'research' with a time window", () => {
  for (const text of [
    "Recherchiere Anbieter für Solarspeicher",
    "Vergleiche die Preise der drei Kandidaten",
    "Analysiere, warum der Server nachts einbricht",
    "Mach mir einen Überblick über die Optionen",
  ]) {
    const result = classifyTask(text, MONDAY);
    assert.equal(result.category, "research", text);
    assert.ok(result.dueAt, `${text} should get a window`);
  }
});

test("research without a stated deadline gets a one-week window", () => {
  const result = classifyTask("Recherchiere Anbieter für Solarspeicher", MONDAY);
  assert.equal(new Date(result.dueAt!).toISOString(), new Date(MONDAY.getTime() + 7 * 24 * 3_600_000).toISOString());
});

test("research picks up the deadline stated in the text", () => {
  const friday = classifyTask("Recherchiere bis Freitag die Anbieter", MONDAY);
  const due = new Date(friday.dueAt!);
  assert.equal(due.getDay(), 5, "Friday");
  assert.equal(due.getDate(), 14, "the Friday of the same week");
  assert.equal(due.getHours(), 23, "day-granular windows end at end of day");

  const inThree = new Date(classifyTask("Analysiere das in 3 Tagen", MONDAY).dueAt!);
  assert.equal(inThree.getDate(), 13);
});

test("recurring wording lands in 'recurring' with the stated cadence", () => {
  const cases: [string, number][] = [
    ["Prüfe täglich die Backups", 24],
    ["Schau stündlich nach dem Speicherplatz", 1],
    ["Wöchentlich die offenen Updates durchgehen", 24 * 7],
    ["Alle 6 Stunden die Temperatur checken", 6],
    ["Alle 2 Tage den Log-Ordner aufräumen", 48],
    ["Jeden Montag den Wochenbericht bauen", 24 * 7],
  ];
  for (const [text, hours] of cases) {
    const result = classifyTask(text, MONDAY);
    assert.equal(result.category, "recurring", text);
    assert.equal(result.intervalHours, hours, text);
  }
});

test("monitoring without a cadence still recurs, once a day", () => {
  for (const text of ["Behalte die Festplattenauslastung im Auge", "Überwache den Backup-Job", "Beobachte die CPU-Last"]) {
    const result = classifyTask(text, MONDAY);
    assert.equal(result.category, "recurring", text);
    assert.equal(result.intervalHours, DEFAULT_INTERVAL_HOURS, text);
  }
});

test("a recurring task carries no due date — the interval is its schedule", () => {
  assert.equal(classifyTask("Prüfe täglich die Backups", MONDAY).dueAt, undefined);
});

test("recurrence beats research when a task says both", () => {
  const result = classifyTask("Recherchiere jede Woche die neuen Angebote", MONDAY);
  assert.equal(result.category, "recurring", "a repeating research job must not lose its repetition");
  assert.equal(result.intervalHours, 24 * 7);
});

test("'jeden Morgen' is a cadence, not the deadline 'morgen'", () => {
  const result = classifyTask("Jeden Morgen die Mails durchgehen", MONDAY);
  assert.equal(result.category, "recurring");
  assert.equal(result.intervalHours, 24);
});

test("classification is case-insensitive", () => {
  assert.equal(classifyTask("RECHERCHIERE DAS MAL", MONDAY).category, "research");
  assert.equal(classifyTask("TÄGLICH PRÜFEN", MONDAY).category, "recurring");
});

test("detectIntervalHours reports nothing when no cadence is stated", () => {
  assert.equal(detectIntervalHours("rechnung schreiben"), undefined);
  assert.equal(detectIntervalHours("alle 30 minuten pingen"), 0.5);
});

test("detectDueAt understands the common German date forms", () => {
  const at = (text: string) => detectDueAt(text, MONDAY)!;
  assert.equal(at("bis morgen").getDate(), 11);
  assert.equal(at("bis übermorgen").getDate(), 12);
  assert.equal(at("in 2 wochen").getDate(), 24);
  assert.equal(at("bis 20.08.").getDate(), 20);
  assert.equal(at("bis 2026-09-01").getMonth(), 8);
  assert.equal(at("diese woche").getDay(), 0, "ends on the coming Sunday");
  assert.equal(at("nächste woche").getDate(), 23, "the Sunday after that");
  assert.equal(at("bis ende des monats").getDate(), 31);
  assert.equal(detectDueAt("irgendwann mal", MONDAY), undefined);
});

test("a bare day-month date that already passed this year means next year", () => {
  const due = detectDueAt("bis 05.02.", MONDAY)!;
  assert.equal(due.getFullYear(), MONDAY.getFullYear() + 1);
  assert.equal(due.getMonth(), 1);
});

test("hour-granular windows keep their exact time instead of snapping to end of day", () => {
  const due = detectDueAt("in 3 stunden", MONDAY)!;
  assert.equal(due.getHours(), 12);
  assert.equal(due.getMinutes(), 0);
});

test("'über Nacht' means done by tomorrow morning, not just sometime tomorrow", () => {
  const due = detectDueAt("schau dir das über nacht an", MONDAY)!;
  assert.equal(due.getDate(), 11);
  assert.equal(due.getHours(), 8);
  assert.equal(due.getMinutes(), 0);

  assert.equal(detectDueAt("look at this overnight", MONDAY)!.getHours(), 8);
});

test("minResearchDurationMs is half the window, capped at 3h and floored at 10min", () => {
  // Short explicit window: half of it, no cap or floor kicking in.
  assert.equal(minResearchDurationMs(4 * 3_600_000), 2 * 3_600_000);
  // Very short window: the 10-minute floor wins over half of it.
  assert.equal(minResearchDurationMs(10 * 60_000), 10 * 60_000);
  // Long/default window (e.g. the one-week default): the 3-hour cap wins.
  assert.equal(minResearchDurationMs(7 * 24 * 3_600_000), 3 * 3_600_000);
});
