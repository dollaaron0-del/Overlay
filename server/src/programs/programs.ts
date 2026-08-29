import { PROGRAM_IDS, type ProgramId, type ProgramMeta } from "@overlay/shared";

/**
 * Sidebar "Dashboards" tiles. Each program's full UI is reverse-proxied
 * same-origin under `/x/<id>/` (see programs.proxy.ts) and iframed by a
 * dashboard window — no CORS, no external tab, works on the kiosk and the iPad.
 */

const TITLES: Record<ProgramId, string> = {
  aktien: "Aktien-Bot",
  "ki-nachhilfe": "KI-Nachhilfe",
};

/** Tile metadata for the sidebar "Dashboards" section — id, label, iframe path. */
export function listProgramMeta(): ProgramMeta[] {
  return PROGRAM_IDS.map((id) => ({ id, title: TITLES[id], path: `/x/${id}/` }));
}

export function isProgramId(x: string): x is ProgramId {
  return x === "aktien" || x === "ki-nachhilfe";
}
