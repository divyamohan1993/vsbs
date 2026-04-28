"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { cn } from "./cn";

export interface ComboboxOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface ComboboxProps {
  options: ComboboxOption[];
  value: string | null;
  onValueChange: (v: string | null) => void;
  placeholder?: string;
  label: string;
  className?: string;
  emptyText?: string;
}

export function Combobox({
  options,
  value,
  onValueChange,
  placeholder = "Search…",
  label,
  className,
  emptyText = "No matches",
}: ComboboxProps): React.JSX.Element {
  const id = useId();
  const listId = `${id}-list`;
  const labelId = `${id}-label`;
  const [query, setQuery] = useState<string>(() => options.find((o) => o.value === value)?.label ?? "");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent): void => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const select = (opt: ComboboxOption): void => {
    if (opt.disabled) return;
    onValueChange(opt.value);
    setQuery(opt.label);
    setOpen(false);
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(filtered.length - 1, h + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const opt = filtered[highlight];
      if (opt) select(opt);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const onChange = (e: ChangeEvent<HTMLInputElement>): void => {
    setQuery(e.target.value);
    setOpen(true);
    setHighlight(0);
    if (e.target.value === "") onValueChange(null);
  };

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <label id={labelId} htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        role="combobox"
        type="text"
        autoComplete="off"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? `${listId}-${highlight}` : undefined}
        value={query}
        onChange={onChange}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
        placeholder={placeholder}
        className="mt-1 w-full rounded-[var(--radius-card)] border border-muted/40 bg-surface px-3 py-2 text-on-surface"
        style={{ backgroundColor: "oklch(20% 0.02 260)" }}
      />
      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-labelledby={labelId}
          className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-[var(--radius-card)] border border-muted/40"
          style={{ backgroundColor: "oklch(20% 0.02 260)" }}
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted">{emptyText}</li>
          ) : (
            filtered.map((opt, i) => (
              <li
                key={opt.value}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === highlight}
                aria-disabled={opt.disabled || undefined}
                onMouseEnter={() => setHighlight(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  select(opt);
                }}
                className={cn(
                  "cursor-pointer px-3 py-2 text-sm",
                  i === highlight ? "bg-accent text-accent-on" : "text-on-surface",
                  opt.disabled ? "cursor-not-allowed opacity-50" : undefined,
                )}
              >
                {opt.label}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
