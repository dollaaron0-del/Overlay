import type { ReactNode } from "react";

/** Passed to a static app's render() so it can navigate elsewhere in the shell (e.g. jump to a project). */
export interface AppNav {
  openProject: (projectId: string) => void;
}

export interface AppDef {
  id: string;
  title: string;
  icon: string;
  render: (nav: AppNav) => ReactNode;
}
