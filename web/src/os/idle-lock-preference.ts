const IDLE_LOCK_STORAGE_KEY = "overlay-idle-lock-minutes";

export type IdleLockPreference = number | "never";

export function getIdleLockMinutes(): IdleLockPreference {
  const stored = localStorage.getItem(IDLE_LOCK_STORAGE_KEY);
  if (stored === "never") return "never";
  const parsed = stored ? Number(stored) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : "never";
}

export function setIdleLockMinutesStorage(value: IdleLockPreference): void {
  localStorage.setItem(IDLE_LOCK_STORAGE_KEY, String(value));
}
