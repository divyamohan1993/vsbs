"use client";

import {
  cloneElement,
  isValidElement,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type HTMLAttributes,
} from "react";
import { cn } from "./cn";

export interface TooltipProps {
  children: ReactElement<HTMLAttributes<HTMLElement>>;
  content: ReactNode;
  delayMs?: number;
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
}

export function Tooltip({ children, content, delayMs = 700, side = "top", className }: TooltipProps): React.JSX.Element {
  const id = useId();
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = (): void => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), delayMs);
  };
  const hide = (): void => {
    if (timer.current) clearTimeout(timer.current);
    setOpen(false);
  };

  if (!isValidElement(children)) {
    throw new Error("Tooltip requires a single React element child.");
  }

  const triggerProps = children.props;
  const trigger = cloneElement(children, {
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
      triggerProps.onMouseEnter?.(e);
      show();
    },
    onMouseLeave: (e: React.MouseEvent<HTMLElement>) => {
      triggerProps.onMouseLeave?.(e);
      hide();
    },
    onFocus: (e: React.FocusEvent<HTMLElement>) => {
      triggerProps.onFocus?.(e);
      show();
    },
    onBlur: (e: React.FocusEvent<HTMLElement>) => {
      triggerProps.onBlur?.(e);
      hide();
    },
    "aria-describedby": open ? id : (triggerProps["aria-describedby"] ?? undefined),
  } as HTMLAttributes<HTMLElement>);

  const positions: Record<typeof side, string> = {
    top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
    bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
    left: "right-full top-1/2 -translate-y-1/2 mr-2",
    right: "left-full top-1/2 -translate-y-1/2 ml-2",
  };

  return (
    <span className="relative inline-flex">
      {trigger}
      {open ? (
        <span
          role="tooltip"
          id={id}
          className={cn(
            "pointer-events-none absolute z-40 whitespace-nowrap rounded-md border border-muted/40 bg-surface px-3 py-1 text-xs text-on-surface shadow-md",
            positions[side],
            className,
          )}
          style={{ backgroundColor: "oklch(20% 0.02 260)" }}
        >
          {content}
        </span>
      ) : null}
    </span>
  );
}
