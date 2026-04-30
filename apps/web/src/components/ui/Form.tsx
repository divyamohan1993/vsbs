"use client";

import {
  useId,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type LabelHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { cn } from "./cn";

const FIELD_BASE =
  "luxe-input w-full rounded-[var(--radius-md)] px-4 py-3.5 text-[var(--text-body)] disabled:cursor-not-allowed disabled:opacity-50";

export function Label({ className, ...rest }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn(
        "luxe-spec-label !text-[var(--text-caption)]",
        className,
      )}
      {...rest}
    />
  );
}

export function Input({ className, type = "text", ...rest }: InputHTMLAttributes<HTMLInputElement> & { type?: string }) {
  const isMono = type === "mono";
  const htmlType = isMono ? "text" : type;
  return (
    <input
      type={htmlType}
      className={cn(FIELD_BASE, "min-h-[56px]", isMono && "luxe-mono", className)}
      {...rest}
    />
  );
}

export function Textarea({ className, rows = 4, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      rows={rows}
      className={cn(FIELD_BASE, "min-h-[7rem] resize-y", className)}
      {...rest}
    />
  );
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(FIELD_BASE, "min-h-[56px] appearance-none bg-[var(--color-graphite)]", className)}
      {...rest}
    >
      {children}
    </select>
  );
}

// ---- Toggle (single-state press button) ----

export interface ToggleProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
  label: string;
}

export function Toggle({ pressed, onPressedChange, label, className, ...rest }: ToggleProps) {
  return (
    <button
      type="button"
      role="button"
      aria-pressed={pressed}
      aria-label={label}
      onClick={() => onPressedChange(!pressed)}
      className={cn(
        "inline-flex items-center gap-2 rounded-[var(--radius-card)] border px-3 py-2 text-sm",
        pressed ? "border-accent bg-accent text-accent-on" : "border-muted/40 text-on-surface",
        className,
      )}
      {...rest}
    />
  );
}

// ---- Switch (sliding boolean) ----

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  label: string;
  className?: string;
}

export function Switch({ checked, onCheckedChange, disabled, label, className }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border-2 transition-colors",
        checked ? "border-accent bg-accent" : "border-muted/40 bg-surface",
        disabled ? "cursor-not-allowed opacity-60" : undefined,
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "inline-block h-5 w-5 rounded-full bg-on-surface shadow transition-transform",
          checked ? "translate-x-5" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

// ---- Checkbox ----

export interface CheckboxProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  label: string;
  id?: string;
  className?: string;
}

export function Checkbox({ checked, onCheckedChange, disabled, label, id, className }: CheckboxProps) {
  const auto = useId();
  const inputId = id ?? auto;
  return (
    <label htmlFor={inputId} className={cn("inline-flex items-center gap-2 text-sm", className)}>
      <input
        id={inputId}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onCheckedChange(e.target.checked)}
        className="h-5 w-5 rounded border border-muted/40 bg-surface accent-[oklch(74%_0.16_200)]"
      />
      <span>{label}</span>
    </label>
  );
}

// ---- RadioGroup ----

export interface RadioGroupOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface RadioGroupProps {
  value: string | null;
  onValueChange: (v: string) => void;
  options: RadioGroupOption[];
  name: string;
  className?: string;
}

export function RadioGroup({ value, onValueChange, options, name, className }: RadioGroupProps) {
  return (
    <fieldset role="radiogroup" className={cn("flex flex-col gap-2", className)}>
      {options.map((o) => (
        <label key={o.value} className="inline-flex items-center gap-2 text-sm">
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={value === o.value}
            disabled={o.disabled}
            onChange={() => onValueChange(o.value)}
            className="h-5 w-5 accent-[oklch(74%_0.16_200)]"
          />
          <span>{o.label}</span>
        </label>
      ))}
    </fieldset>
  );
}

// ---- Slider ----

export interface SliderProps {
  value: number;
  onValueChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label: string;
  className?: string;
  formatValue?: (v: number) => string;
}

export function Slider({ value, onValueChange, min = 0, max = 100, step = 1, label, className, formatValue }: SliderProps) {
  const id = useId();
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex justify-between text-sm">
        <label htmlFor={id} className="font-medium">
          {label}
        </label>
        <span aria-hidden="true" className="font-mono">
          {formatValue ? formatValue(value) : value}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onValueChange(Number(e.target.value))}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={formatValue ? formatValue(value) : String(value)}
        className="h-2 w-full appearance-none rounded-full bg-muted/30 accent-[oklch(74%_0.16_200)]"
      />
    </div>
  );
}

// ---- Badge ----

export type BadgeTone = "neutral" | "info" | "success" | "warning" | "danger";

export function Badge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: BadgeTone;
  children: React.ReactNode;
  className?: string;
}) {
  const tones: Record<BadgeTone, string> = {
    neutral: "border-[var(--color-hairline-strong)] bg-white/[0.04] text-pearl",
    info: "border-[var(--color-accent-sky)] bg-[rgba(79,183,255,0.12)] text-pearl",
    success: "border-[var(--color-emerald)] bg-[rgba(31,143,102,0.14)] text-pearl",
    warning: "border-[var(--color-amber)] bg-[rgba(217,164,65,0.14)] text-pearl",
    danger: "border-[var(--color-crimson)] bg-[rgba(178,58,72,0.18)] text-pearl",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-3 py-1 text-[var(--text-caption)] font-medium tracking-[var(--tracking-wider)] uppercase",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

// ---- Avatar ----

export interface AvatarProps {
  initials: string;
  src?: string;
  alt: string;
  size?: number;
  className?: string;
}

export function Avatar({ initials, src, alt, size = 40, className }: AvatarProps) {
  return (
    <span
      role="img"
      aria-label={alt}
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-on-surface/10 font-semibold text-on-surface",
        className,
      )}
      style={{ width: size, height: size, minWidth: size, minHeight: size }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" width={size} height={size} className="object-cover" />
      ) : (
        <span aria-hidden="true">{initials.slice(0, 2).toUpperCase()}</span>
      )}
    </span>
  );
}

// ---- Alert ----

export type AlertTone = "info" | "success" | "warning" | "danger";

export function Alert({
  tone = "info",
  title,
  children,
  className,
}: {
  tone?: AlertTone;
  title: string;
  children?: React.ReactNode;
  className?: string;
}) {
  const titleId = useId();
  const tones: Record<AlertTone, string> = {
    info: "border-[var(--color-accent-sky)] bg-[rgba(79,183,255,0.08)]",
    success: "border-[var(--color-emerald)] bg-[rgba(31,143,102,0.10)]",
    warning: "border-[var(--color-amber)] bg-[rgba(217,164,65,0.10)]",
    danger: "border-[var(--color-crimson)] bg-[rgba(178,58,72,0.12)]",
  };
  return (
    <div
      role={tone === "danger" || tone === "warning" ? "alert" : "status"}
      aria-labelledby={titleId}
      className={cn(
        "luxe-glass-muted rounded-[var(--radius-md)] border-l-2 p-5",
        tones[tone],
        className,
      )}
    >
      <p
        id={titleId}
        className="font-medium tracking-[var(--tracking-wide)] text-pearl"
      >
        {title}
      </p>
      {children ? <div className="mt-2 text-[var(--text-control)] text-pearl-muted leading-[1.6]">{children}</div> : null}
    </div>
  );
}

// ---- Progress ----

export interface ProgressProps {
  value: number;
  max?: number;
  label: string;
  className?: string;
}

export function Progress({ value, max = 100, label, className }: ProgressProps) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <span className="sr-only">{label}</span>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        className="h-2 w-full overflow-hidden rounded-full bg-muted/30"
      >
        <div
          aria-hidden="true"
          className="h-full bg-accent transition-[width]"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
