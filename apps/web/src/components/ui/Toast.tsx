"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "./cn";

export type ToastTone = "info" | "success" | "warning" | "danger";
export interface ToastInput {
  title: string;
  description?: string;
  tone?: ToastTone;
  durationMs?: number;
}
interface ToastEntry extends Required<Pick<ToastInput, "title" | "tone" | "durationMs">> {
  id: string;
  description?: string;
}

interface ToastCtx {
  push: (t: ToastInput) => string;
  dismiss: (id: string) => void;
}

const Ctx = createContext<ToastCtx | null>(null);

export function ToastProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [entries, setEntries] = useState<ToastEntry[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    setEntries((curr) => curr.filter((e) => e.id !== id));
    const t = timers.current.get(id);
    if (t) {
      clearTimeout(t);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (t: ToastInput): string => {
      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const entry: ToastEntry = {
        id,
        title: t.title,
        ...(t.description !== undefined ? { description: t.description } : {}),
        tone: t.tone ?? "info",
        durationMs: t.durationMs ?? 5000,
      };
      setEntries((curr) => [...curr, entry]);
      if (entry.durationMs > 0) {
        const handle = setTimeout(() => dismiss(id), entry.durationMs);
        timers.current.set(id, handle);
      }
      return id;
    },
    [dismiss],
  );

  useEffect(() => {
    return () => {
      for (const handle of timers.current.values()) clearTimeout(handle);
      timers.current.clear();
    };
  }, []);

  const value = useMemo<ToastCtx>(() => ({ push, dismiss }), [push, dismiss]);
  return (
    <Ctx value={value}>
      {children}
      <div
        role="region"
        aria-label="Notifications"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4"
      >
        {entries.map((e) => (
          <output
            key={e.id}
            aria-live={e.tone === "danger" || e.tone === "warning" ? "assertive" : "polite"}
            className={cn(
              "pointer-events-auto w-full max-w-md rounded-[var(--radius-card)] border p-4 text-on-surface shadow-lg",
              e.tone === "danger"
                ? "border-danger bg-danger/20"
                : e.tone === "warning"
                  ? "border-accent bg-accent/15"
                  : e.tone === "success"
                    ? "border-success bg-success/15"
                    : "border-muted/40 bg-surface",
            )}
            style={{ backgroundColor: e.tone === "info" ? "oklch(20% 0.02 260)" : undefined }}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{e.title}</p>
                {e.description ? <p className="mt-1 text-sm text-muted">{e.description}</p> : null}
              </div>
              <button
                type="button"
                onClick={() => dismiss(e.id)}
                aria-label="Dismiss notification"
                className="text-muted hover:text-on-surface"
              >
                ×
              </button>
            </div>
          </output>
        ))}
      </div>
    </Ctx>
  );
}

export function useToast(): ToastCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useToast must be used inside <ToastProvider>");
  return v;
}
