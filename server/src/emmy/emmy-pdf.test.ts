import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMarkdownToPdf, pdfFilenameFor } from "./emmy-pdf.js";

test("renderMarkdownToPdf produces a valid, non-trivial PDF", async () => {
  const markdown = [
    "# Zusammenfassung",
    "",
    "Ein **wichtiger** Punkt mit `code` und einem [Link](https://example.com).",
    "",
    "## Details",
    "- erster Punkt",
    "- zweiter Punkt",
    "",
    "1. eins",
    "2. zwei",
    "",
    "> Ein Zitat.",
    "",
    "```",
    "const x = 1;",
    "```",
    "",
    "| A | B |",
    "|---|---|",
    "| 1 | 2 |",
    "",
    "---",
    "",
    "Letzter Absatz.",
  ].join("\n");

  const pdf = await renderMarkdownToPdf(markdown, "Testbericht");
  assert.ok(Buffer.isBuffer(pdf));
  assert.ok(pdf.length > 500, "expected a non-trivial PDF byte size");
  assert.equal(pdf.subarray(0, 5).toString("latin1"), "%PDF-");
});

test("renderMarkdownToPdf handles empty text without throwing", async () => {
  const pdf = await renderMarkdownToPdf("", "Leer");
  assert.ok(pdf.subarray(0, 5).toString("latin1") === "%PDF-");
});

test("pdfFilenameFor sanitizes the title and keeps the date", () => {
  assert.equal(pdfFilenameFor("Server: Storage / Ausfall?!", "2026-08-15T10:00:00.000Z"), "emmy-Server-Storage-Ausfall-2026-08-15.pdf");
  assert.equal(pdfFilenameFor("   ", "2026-08-15T10:00:00.000Z"), "emmy-bericht-2026-08-15.pdf");
});
