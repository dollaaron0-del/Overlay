import type { ReactNode } from "react";

export interface AppDef {
  id: string;
  title: string;
  icon: string;
  /** Small colored dot shown on the icon, e.g. a project's online/offline status. */
  statusDot?: "online" | "stopped" | "errored" | "unknown";
  render: () => ReactNode;
}
