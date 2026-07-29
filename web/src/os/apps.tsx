import type { AppDef } from "./types";
import { SecurityDashboard } from "../security/SecurityDashboard";
import { ActivityLog } from "../activity/ActivityLog";
import { SettingsApp } from "../settings/SettingsApp";
import { QuickCaptureApp } from "../quickcapture/QuickCaptureApp";

/**
 * Static, always-present apps (as opposed to project apps, which are
 * generated dynamically from the live project list — see HomeScreen.tsx).
 * `render` must return JSX (not call the component as a plain function) so
 * React's hooks inside each app stay tied to their own component identity
 * rather than the caller's.
 */
export const STATIC_APPS: AppDef[] = [
  { id: "security", title: "Sicherheit", icon: "🛡", render: () => <SecurityDashboard /> },
  { id: "activity", title: "Aktivität", icon: "📋", render: () => <ActivityLog /> },
  { id: "quickcapture", title: "Schnellnotiz", icon: "📝", render: () => <QuickCaptureApp /> },
  { id: "settings", title: "Einstellungen", icon: "⚙️", render: () => <SettingsApp /> },
];

export function getStaticApp(id: string): AppDef | undefined {
  return STATIC_APPS.find((a) => a.id === id);
}
