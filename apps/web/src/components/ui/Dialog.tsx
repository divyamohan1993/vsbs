"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { cn } from "./cn";
import { trapFocus } from "./focusTrap";

interface DialogCtx {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  titleId: string;
  descId: string;
}

const Ctx = createContext<DialogCtx | null>(null);

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}

export function Dialog({ open, onOpenChange, children }: DialogProps) {
  const titleId = useId();
  const descId = useId();
  return <Ctx value={{ open, onOpenChange, titleId, descId }}>{children}</Ctx>;
}

export function DialogTrigger({
  asChild,
  children,
  ...rest
}: { asChild?: boolean; children: ReactNode } & HTMLAttributes<HTMLButtonElement>): React.JSX.Element {
  const ctx = useDialog();
  const onClick = (): void => ctx.onOpenChange(true);
  if (asChild) {
    return <span onClick={onClick}>{children}</span>;
  }
  return (
    <button type="button" onClick={onClick} {...rest}>
      {children}
    </button>
  );
}

export interface DialogContentProps extends HTMLAttributes<HTMLDivElement> {
  closeOnEsc?: boolean;
  closeOnBackdrop?: boolean;
}

export function DialogContent({
  children,
  closeOnEsc = true,
  closeOnBackdrop = true,
  className,
  ...rest
}: DialogContentProps): React.JSX.Element | null {
  const ctx = useDialog();
  const ref = useRef<HTMLDivElement | null>(null);
  const lastFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!ctx.open) return;
    lastFocus.current = (document.activeElement as HTMLElement | null) ?? null;
    const node = ref.current;
    if (node) {
      const focusables = node.querySelectorAll<HTMLElement>("[autofocus], input, button");
      const first = focusables[0] ?? node;
      first.focus();
    }
    const onKey = (e: KeyboardEvent): void => {
      if (closeOnEsc && e.key === "Escape") {
        e.preventDefault();
        ctx.onOpenChange(false);
        return;
      }
      if (node) trapFocus(node, e);
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      lastFocus.current?.focus?.();
    };
  }, [ctx, closeOnEsc]);

  if (!ctx.open) return null;
  return (
    <div
      role="presentation"
      onMouseDown={(e) => {
        if (!closeOnBackdrop) return;
        if (e.target === e.currentTarget) ctx.onOpenChange(false);
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(8,9,12,0.82)] p-6"
      style={{ backdropFilter: "blur(8px) saturate(120%)" }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={ctx.titleId}
        aria-describedby={ctx.descId}
        tabIndex={-1}
        className={cn(
          "luxe-glass-elevated relative w-full max-w-[640px] rounded-[var(--radius-xl)] p-8 outline-none",
          className,
        )}
        {...rest}
      >
        {children}
      </div>
    </div>
  );
}

export function DialogTitle({ className, children, ...rest }: HTMLAttributes<HTMLHeadingElement>): React.JSX.Element {
  const ctx = useDialog();
  return (
    <h2
      id={ctx.titleId}
      className={cn(
        "font-[family-name:var(--font-display)] text-[var(--text-h3)] font-medium tracking-[var(--tracking-tight)] text-pearl",
        className,
      )}
      {...rest}
    >
      {children}
    </h2>
  );
}

export function DialogDescription({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLParagraphElement>): React.JSX.Element {
  const ctx = useDialog();
  return (
    <p id={ctx.descId} className={cn("mt-3 text-[var(--text-control)] text-pearl-muted leading-[1.6]", className)} {...rest}>
      {children}
    </p>
  );
}

export function DialogFooter({
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return <div className={cn("mt-8 flex flex-wrap items-center justify-end gap-3", className)} {...rest} />;
}

export function DialogClose({ children, ...rest }: HTMLAttributes<HTMLButtonElement>): React.JSX.Element {
  const ctx = useDialog();
  const onClick = useCallback(() => ctx.onOpenChange(false), [ctx]);
  return (
    <button type="button" onClick={onClick} {...rest}>
      {children}
    </button>
  );
}

function useDialog(): DialogCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("Dialog primitives must be used inside a <Dialog>");
  return v;
}
