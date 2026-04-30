"use client";

import type { ButtonHTMLAttributes } from "react";
import { cn } from "./cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "outline";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  loadingText?: string;
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "luxe-btn-primary",
  secondary:
    "luxe-glass text-pearl hover:[border-color:var(--color-hairline-hover)]",
  ghost:
    "bg-transparent text-pearl hover:bg-white/5 border border-transparent",
  danger:
    "bg-[var(--color-crimson-deep)] text-pearl border border-[var(--color-crimson)] hover:bg-[var(--color-crimson)]",
  outline:
    "bg-transparent text-pearl border border-[var(--color-hairline-strong)] hover:[border-color:var(--color-copper)]",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "px-4 py-2 text-[var(--text-control)] min-h-[44px] rounded-[var(--radius-sm)]",
  md: "px-6 py-3 text-[var(--text-body)] min-h-[48px] rounded-[var(--radius-md)]",
  lg: "px-8 py-4 text-[var(--text-body)] min-h-[56px] rounded-[var(--radius-md)]",
};

export function Button({
  variant = "primary",
  size = "md",
  loading,
  loadingText,
  children,
  className,
  disabled,
  type = "button",
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <button
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      data-variant={variant}
      data-size={size}
      className={cn(
        "inline-flex items-center justify-center gap-2 font-medium tracking-[var(--tracking-wide)]",
        "transition-[filter,transform,box-shadow,background-color,border-color]",
        "duration-[var(--duration-state)] ease-[var(--ease-enter)]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? (
        <>
          <span
            aria-hidden="true"
            className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
          />
          <span>{loadingText ?? children}</span>
        </>
      ) : (
        children
      )}
    </button>
  );
}
