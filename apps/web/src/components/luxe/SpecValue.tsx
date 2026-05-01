// SpecValue — serif numeric display with optional mono unit suffix. Pairs
// with SpecLabel above. The unit is rendered smaller and in mono so the eye
// reads the magnitude first and the dimension second.

import { cn } from "../ui/cn";

export interface SpecValueProps {
  value: string | number;
  unit?: string;
  size?: "md" | "lg" | "xl" | "hero";
  className?: string;
}

const SIZES: Record<NonNullable<SpecValueProps["size"]>, string> = {
  md: "text-[length:var(--text-h3)]",
  lg: "text-[length:var(--text-h2)]",
  xl: "text-[length:var(--text-h1)]",
  hero: "text-[length:var(--text-display)] md:text-[length:var(--text-hero)]",
};

const UNIT_SIZES: Record<NonNullable<SpecValueProps["size"]>, string> = {
  md: "text-[length:var(--text-caption)]",
  lg: "text-[length:var(--text-small)]",
  xl: "text-[length:var(--text-control)]",
  hero: "text-[length:var(--text-body)]",
};

export function SpecValue({ value, unit, size = "lg", className }: SpecValueProps): React.JSX.Element {
  return (
    <span className={cn("inline-flex items-baseline gap-2", className)}>
      <span className={cn("luxe-spec-value", SIZES[size])}>{value}</span>
      {unit ? (
        <span className={cn("luxe-mono uppercase text-pearl-soft", UNIT_SIZES[size])}>{unit}</span>
      ) : null}
    </span>
  );
}
