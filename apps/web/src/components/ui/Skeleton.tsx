import type { HTMLAttributes } from "react";
import { cn } from "./cn";

export function Skeleton({ className, ...rest }: HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded-md bg-on-surface/10 motion-reduce:animate-none", className)}
      {...rest}
    />
  );
}
