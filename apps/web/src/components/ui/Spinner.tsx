import type { HTMLAttributes } from "react";
import { cn } from "./cn";

export interface SpinnerProps extends HTMLAttributes<HTMLDivElement> {
  size?: "sm" | "md" | "lg";
  label?: string;
}

const SIZES = { sm: "h-4 w-4", md: "h-6 w-6", lg: "h-10 w-10" } as const;

export function Spinner({ size = "md", label = "Loading", className, ...rest }: SpinnerProps): React.JSX.Element {
  return (
    <div role="status" aria-label={label} className={cn("inline-flex items-center", className)} {...rest}>
      <span
        aria-hidden="true"
        className={cn(
          "inline-block animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none",
          SIZES[size],
        )}
      />
      <span className="sr-only">{label}</span>
    </div>
  );
}
