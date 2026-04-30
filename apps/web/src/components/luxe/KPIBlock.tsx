// KPIBlock — labelled numeric tile with a status hairline beneath. The
// hairline colour reflects the operational state: ok (emerald), watch
// (amber), alert (crimson). Status defaults to "ok" — never neutral, because
// a number without a state is a number without a story.

import { cn } from "../ui/cn";
import { SpecLabel } from "./SpecLabel";
import { SpecValue } from "./SpecValue";

export interface KPIBlockProps {
  label: string;
  value: string | number;
  unit?: string;
  status?: "ok" | "watch" | "alert";
  description?: string;
  size?: "md" | "lg" | "xl";
  className?: string;
}

export function KPIBlock({
  label,
  value,
  unit,
  status = "ok",
  description,
  size = "lg",
  className,
}: KPIBlockProps): React.JSX.Element {
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <SpecLabel>{label}</SpecLabel>
      <SpecValue value={value} {...(unit !== undefined ? { unit } : {})} size={size} />
      <div className={cn("luxe-status-line", status)} aria-hidden="true" />
      {description ? (
        <p className="text-pearl-soft text-[var(--text-small)] leading-[1.6]">{description}</p>
      ) : null}
    </div>
  );
}
