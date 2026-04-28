import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

const VARIANT: Record<Variant, string> = {
  primary: "bg-accent text-accent-on hover:opacity-95",
  secondary: "bg-surface-3 text-on-surface border border-[var(--color-border)] hover:bg-surface-2",
  danger: "bg-danger text-danger-on hover:opacity-95",
};

export function Button({ variant = "primary", className, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      className={`inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-semibold disabled:opacity-50 ${VARIANT[variant]} ${className ?? ""}`}
    />
  );
}
