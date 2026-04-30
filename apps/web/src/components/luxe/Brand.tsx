// Brand — the wordmark. "VSBS" in display serif, with a faint hairline above
// and a small caps subtitle "AUTONOMOUS SERVICE" beneath. Two sizes: "lg"
// for hero placements, "sm" for header bars.

import { cn } from "../ui/cn";

export interface BrandProps {
  size?: "sm" | "lg";
  showSubtitle?: boolean;
  className?: string;
}

const WORDMARK_SIZES: Record<NonNullable<BrandProps["size"]>, string> = {
  sm: "text-[1.5rem] tracking-[0.04em]",
  lg: "text-[3rem] md:text-[4rem] tracking-[0.02em]",
};

const SUBTITLE_SIZES: Record<NonNullable<BrandProps["size"]>, string> = {
  sm: "text-[0.625rem]",
  lg: "text-[0.75rem]",
};

export function Brand({
  size = "sm",
  showSubtitle = true,
  className,
}: BrandProps): React.JSX.Element {
  return (
    <span
      className={cn(
        "inline-flex flex-col items-start leading-none",
        className,
      )}
    >
      <span aria-hidden="true" className="luxe-brand-rule mb-1.5 w-12" />
      <span
        className={cn(
          "font-[family-name:var(--font-display)] font-medium text-pearl",
          WORDMARK_SIZES[size],
        )}
      >
        VSBS
      </span>
      {showSubtitle ? (
        <span
          className={cn(
            "mt-1.5 luxe-spec-label",
            SUBTITLE_SIZES[size],
          )}
        >
          Autonomous Service
        </span>
      ) : null}
    </span>
  );
}
