// SpecLabel — small caps section announcer. Use above any value, KPI, or
// section heading where the eye should "land" on the meaning before the
// content. Tracking 0.16em, 12px, 56% pearl opacity.

import type { HTMLAttributes } from "react";
import { cn } from "../ui/cn";

export function SpecLabel({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLSpanElement>): React.JSX.Element {
  return (
    <span className={cn("luxe-spec-label", className)} {...rest}>
      {children}
    </span>
  );
}
