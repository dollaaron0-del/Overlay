// Sidebar "Dashboards" tile metadata. Each program's full UI is reverse-proxied
// same-origin under /x/<id>/ by the Overlay server (see programs.proxy.ts) and
// rendered in an iframe dashboard window.

export type ProgramId = "aktien" | "ki-nachhilfe";

export const PROGRAM_IDS: ProgramId[] = ["aktien", "ki-nachhilfe"];

/** Sidebar tile metadata: label + the same-origin path the dashboard window iframes. */
export interface ProgramMeta {
  id: ProgramId;
  title: string;
  /** e.g. "/x/aktien/" — reverse-proxied to the program by the Overlay server. */
  path: string;
}
