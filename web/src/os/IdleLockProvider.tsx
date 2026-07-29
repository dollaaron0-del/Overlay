import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { LockScreen } from "./LockScreen";
import { getIdleLockMinutes, setIdleLockMinutesStorage, type IdleLockPreference } from "./idle-lock-preference";

interface IdleLockContextValue {
  minutes: IdleLockPreference;
  setMinutes: (value: IdleLockPreference) => void;
}

const IdleLockContext = createContext<IdleLockContextValue | null>(null);

const ACTIVITY_EVENTS = ["mousemove", "keydown", "pointerdown", "touchstart", "scroll"] as const;

export function IdleLockProvider({ children }: { children: ReactNode }) {
  const [minutes, setMinutesState] = useState<IdleLockPreference>(getIdleLockMinutes);
  const [locked, setLocked] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lockedRef = useRef(locked);
  lockedRef.current = locked;

  const resetTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (minutes === "never") return;
    timerRef.current = setTimeout(() => setLocked(true), minutes * 60_000);
  }, [minutes]);

  useEffect(() => {
    resetTimer();
    const onActivity = () => {
      if (!lockedRef.current) resetTimer();
    };
    for (const event of ACTIVITY_EVENTS) window.addEventListener(event, onActivity);
    return () => {
      for (const event of ACTIVITY_EVENTS) window.removeEventListener(event, onActivity);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [resetTimer]);

  const setMinutes = (value: IdleLockPreference) => {
    setMinutesState(value);
    setIdleLockMinutesStorage(value);
  };

  return (
    <IdleLockContext.Provider value={{ minutes, setMinutes }}>
      {children}
      {locked && <LockScreen onUnlock={() => setLocked(false)} />}
    </IdleLockContext.Provider>
  );
}

export function useIdleLock(): IdleLockContextValue {
  const ctx = useContext(IdleLockContext);
  if (!ctx) throw new Error("useIdleLock must be used within IdleLockProvider");
  return ctx;
}
