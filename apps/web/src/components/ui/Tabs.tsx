"use client";

import {
  createContext,
  useContext,
  useId,
  useRef,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { cn } from "./cn";

interface TabsCtx {
  value: string;
  onValueChange: (v: string) => void;
  baseId: string;
  orientation: "horizontal" | "vertical";
}

const Ctx = createContext<TabsCtx | null>(null);

export interface TabsProps {
  value: string;
  onValueChange: (v: string) => void;
  orientation?: "horizontal" | "vertical";
  className?: string;
  children: ReactNode;
}

export function Tabs({ value, onValueChange, orientation = "horizontal", className, children }: TabsProps) {
  const baseId = useId();
  return (
    <Ctx value={{ value, onValueChange, baseId, orientation }}>
      <div className={cn(orientation === "vertical" ? "flex gap-4" : undefined, className)}>{children}</div>
    </Ctx>
  );
}

export function TabsList({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  const ctx = useTabs();
  const ref = useRef<HTMLDivElement | null>(null);
  const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    const list = ref.current;
    if (!list) return;
    const tabs = Array.from(list.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    if (tabs.length === 0) return;
    const i = tabs.findIndex((t) => t === document.activeElement);
    const last = tabs.length - 1;
    const horiz = ctx.orientation === "horizontal";
    let next = -1;
    if ((horiz && e.key === "ArrowRight") || (!horiz && e.key === "ArrowDown")) next = (i + 1) % tabs.length;
    else if ((horiz && e.key === "ArrowLeft") || (!horiz && e.key === "ArrowUp")) next = i <= 0 ? last : i - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = last;
    if (next >= 0) {
      e.preventDefault();
      tabs[next]?.focus();
      tabs[next]?.click();
    }
  };
  return (
    <div
      ref={ref}
      role="tablist"
      aria-orientation={ctx.orientation}
      onKeyDown={onKey}
      className={cn("flex gap-2 border-b border-muted/30", className)}
      {...rest}
    >
      {children}
    </div>
  );
}

export interface TabsTriggerProps extends HTMLAttributes<HTMLButtonElement> {
  value: string;
}

export function TabsTrigger({ value, className, children, ...rest }: TabsTriggerProps): React.JSX.Element {
  const ctx = useTabs();
  const selected = ctx.value === value;
  const tabId = `${ctx.baseId}-tab-${value}`;
  const panelId = `${ctx.baseId}-panel-${value}`;
  return (
    <button
      type="button"
      role="tab"
      id={tabId}
      aria-selected={selected}
      aria-controls={panelId}
      tabIndex={selected ? 0 : -1}
      onClick={() => ctx.onValueChange(value)}
      data-state={selected ? "active" : "inactive"}
      className={cn(
        "px-4 py-2 text-sm font-semibold",
        selected ? "border-b-2 border-accent text-on-surface" : "text-muted hover:text-on-surface",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export interface TabsContentProps extends HTMLAttributes<HTMLDivElement> {
  value: string;
}

export function TabsContent({ value, className, children, ...rest }: TabsContentProps): React.JSX.Element | null {
  const ctx = useTabs();
  if (ctx.value !== value) return null;
  const tabId = `${ctx.baseId}-tab-${value}`;
  const panelId = `${ctx.baseId}-panel-${value}`;
  return (
    <div role="tabpanel" id={panelId} aria-labelledby={tabId} tabIndex={0} className={cn("py-4", className)} {...rest}>
      {children}
    </div>
  );
}

function useTabs(): TabsCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("Tabs primitives must be used inside <Tabs>");
  return v;
}
