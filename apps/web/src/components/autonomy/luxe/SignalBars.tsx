"use client";

// SignalBars — three-segment indicator that mirrors the cellular bar metaphor.
// websocket = three filled, sse = two, local-sim = one, disconnected = none.
// Connecting reuses the local-sim treatment but with a soft pulse if motion
// is allowed.

import { cn } from "../../ui/cn";

export type SignalLevel = 0 | 1 | 2 | 3;

interface SignalBarsProps {
  level: SignalLevel;
  label: string;
  active?: boolean;
  className?: string;
}

const ACTIVE_FILL: Record<number, string> = {
  3: "var(--color-emerald)",
  2: "var(--color-accent-sky)",
  1: "var(--color-amber)",
  0: "var(--color-hairline-strong)",
};

export function SignalBars({ level, label, active = true, className }: SignalBarsProps): React.JSX.Element {
  const fill = active ? ACTIVE_FILL[level] : "var(--color-hairline-strong)";
  return (
    <span
      role="img"
      aria-label={`${label} signal level ${level} of 3`}
      className={cn("inline-flex items-end gap-[3px]", className)}
    >
      {[1, 2, 3].map((i) => {
        const filled = level >= i;
        return (
          <span
            key={i}
            aria-hidden="true"
            className="block w-[3px] rounded-[1px]"
            style={{
              height: 4 + i * 4,
              background: filled ? fill : "var(--color-hairline)",
              transition: "background 240ms var(--ease-enter)",
            }}
          />
        );
      })}
    </span>
  );
}
