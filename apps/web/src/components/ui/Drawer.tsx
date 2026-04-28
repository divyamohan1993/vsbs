"use client";

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { cn } from "./cn";
import { trapFocus } from "./focusTrap";

export type DrawerSide = "left" | "right" | "top" | "bottom";

interface DrawerCtx {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side: DrawerSide;
  titleId: string;
}
const Ctx = createContext<DrawerCtx | null>(null);

export interface DrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side?: DrawerSide;
  children: ReactNode;
}

export function Drawer({ open, onOpenChange, side = "right", children }: DrawerProps) {
  const titleId = useId();
  return <Ctx value={{ open, onOpenChange, side, titleId }}>{children}</Ctx>;
}

export function DrawerContent({ children, className, ...rest }: HTMLAttributes<HTMLDivElement>): React.JSX.Element | null {
  const ctx = useDrawer();
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!ctx.open) return;
    const node = ref.current;
    if (node) {
      const f = node.querySelector<HTMLElement>("[autofocus], input, button");
      (f ?? node).focus();
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        ctx.onOpenChange(false);
        return;
      }
      if (node) trapFocus(node, e);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [ctx]);

  if (!ctx.open) return null;
  const sideClasses: Record<DrawerSide, string> = {
    right: "inset-y-0 right-0 h-full w-full max-w-sm",
    left: "inset-y-0 left-0 h-full w-full max-w-sm",
    top: "inset-x-0 top-0 w-full max-h-[80vh]",
    bottom: "inset-x-0 bottom-0 w-full max-h-[80vh]",
  };
  return (
    <div
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) ctx.onOpenChange(false);
      }}
      className="fixed inset-0 z-50 bg-black/70"
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={ctx.titleId}
        tabIndex={-1}
        className={cn(
          "fixed border border-muted/30 p-6 outline-none",
          sideClasses[ctx.side],
          className,
        )}
        style={{ backgroundColor: "oklch(18% 0.02 260)" }}
        {...rest}
      >
        {children}
      </div>
    </div>
  );
}

export function DrawerTitle({ className, children, ...rest }: HTMLAttributes<HTMLHeadingElement>): React.JSX.Element {
  const ctx = useDrawer();
  return (
    <h2 id={ctx.titleId} className={cn("font-display text-xl font-semibold", className)} {...rest}>
      {children}
    </h2>
  );
}

function useDrawer(): DrawerCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("Drawer primitives must be used inside <Drawer>");
  return v;
}

// Sheet — semantic alias for a side panel. API-identical to Drawer for callers
// that expect the shadcn naming.
export const Sheet = Drawer;
export const SheetContent = DrawerContent;
export const SheetTitle = DrawerTitle;
