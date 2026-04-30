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
        {entries.map((e) => {
          const edge: Record<ToastTone, string> = {
            info: "before:bg-[var(--color-accent-sky)]",
            success: "before:bg-[var(--color-emerald)]",
            warning: "before:bg-[var(--color-amber)]",
            danger: "before:bg-[var(--color-crimson)]",
          };
          return (
            <output
              key={e.id}
              aria-live={e.tone === "danger" || e.tone === "warning" ? "assertive" : "polite"}
              className={cn(
                "luxe-glass-elevated pointer-events-auto relative w-full max-w-md overflow-hidden rounded-[var(--radius-md)] p-5 pl-6 text-pearl",
                "before:absolute before:left-0 before:top-0 before:h-full before:w-[3px]",
                edge[e.tone],
              )}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-medium tracking-[var(--tracking-wide)]">{e.title}</p>
                  {e.description ? (
                    <p className="mt-1 text-[var(--text-control)] text-pearl-muted leading-[1.55]">{e.description}</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => dismiss(e.id)}
                  aria-label="Dismiss notification"
                  className="-mr-2 -mt-2 text-pearl-soft hover:text-pearl"
                >
                  ×
                </button>
              </div>
            </output>
          );
        })}
      </div>
    </Ctx>
  );
}

export function useToast(): ToastCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useToast must be used inside <ToastProvider>");
  return v;
}
