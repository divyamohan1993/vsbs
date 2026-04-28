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
  primary:
    "bg-accent text-accent-on hover:opacity-90 active:opacity-80 focus-visible:ring-accent",
  secondary:
    "bg-on-surface/10 text-on-surface hover:bg-on-surface/20 focus-visible:ring-accent",
  ghost:
    "bg-transparent text-on-surface hover:bg-on-surface/10 focus-visible:ring-accent",
  danger:
    "bg-danger text-on-surface hover:opacity-90 focus-visible:ring-danger",
  outline:
    "border-2 border-on-surface/40 bg-transparent text-on-surface hover:bg-on-surface/10",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "px-3 py-2 text-sm",
  md: "px-4 py-2 text-base",
  lg: "px-6 py-3 text-base",
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
        "inline-flex items-center justify-center gap-2 rounded-[var(--radius-card)] font-semibold",
        "transition-opacity",
        "disabled:cursor-not-allowed disabled:opacity-60",
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
