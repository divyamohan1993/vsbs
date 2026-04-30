// EmptyState / LoadingState / ErrorState / SuccessState — luxe surfaces.
//
// All four surfaces share a single GlassPanel shell so the eye reads a
// consistent rhythm across the app. Tone is conveyed by content + a
// hairline accent, never by drop-shadow theatre. The illustrations are
// inline SVG so they paint on first frame and respect text colour.

import { useId, type ReactNode } from "react";
import { cn } from "../ui/cn";
import { GlassPanel } from "../luxe/GlassPanel";
import { AmbientGlow } from "../luxe/AmbientGlow";
import { GoldSeal } from "../luxe/GoldSeal";
import { SpecLabel } from "../luxe/SpecLabel";

interface BaseProps {
  heading: string;
  body?: ReactNode;
  /** Optional small caps eyebrow above the heading. */
  eyebrow?: string;
  action?: { label: string; onClick: () => void } | { label: string; href: string };
  /** Optional secondary ghost action. */
  secondary?: { label: string; href: string };
  className?: string;
}

const HEADING_CLS =
  "font-[family-name:var(--font-display)] text-[var(--text-h3)] font-medium tracking-[var(--tracking-tight)] text-pearl";
const BODY_CLS = "text-[var(--text-body)] leading-[1.6] text-pearl-muted max-w-[44ch]";
const PANEL_CLS = "relative isolate overflow-hidden flex flex-col items-center gap-5 px-8 py-10 text-center";

function ActionButton({
  action,
  primary = true,
}: {
  action: NonNullable<BaseProps["action"]> | NonNullable<BaseProps["secondary"]>;
  primary?: boolean;
}): React.JSX.Element {
  const cls = primary
    ? "luxe-btn-primary inline-flex min-h-[48px] items-center justify-center rounded-[var(--radius-md)] px-6 py-3 text-[var(--text-body)] font-medium tracking-[var(--tracking-wide)]"
    : "luxe-glass inline-flex min-h-[48px] items-center justify-center rounded-[var(--radius-md)] px-6 py-3 text-[var(--text-control)] tracking-[var(--tracking-wide)] text-pearl hover:[border-color:var(--color-hairline-hover)]";
  if ("href" in action) {
    return (
      <a href={action.href} className={cls}>
        {action.label}
      </a>
    );
  }
  return (
    <button type="button" onClick={action.onClick} className={cls}>
      {action.label}
    </button>
  );
}

// ---- Spinner: 24px circular hairline ring with copper sweep ----
export function HairlineSpinner({ size = 24 }: { size?: number }): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      className="inline-block animate-spin rounded-full"
      style={{
        width: size,
        height: size,
        background: "conic-gradient(from 0deg, transparent 0deg, transparent 270deg, var(--color-copper) 360deg)",
        WebkitMask: "radial-gradient(circle, transparent 38%, #000 40%)",
        mask: "radial-gradient(circle, transparent 38%, #000 40%)",
      }}
    />
  );
}

// ---- EmptyState ----
export function EmptyState({
  heading,
  body,
  eyebrow,
  action,
  secondary,
  className,
}: BaseProps): React.JSX.Element {
  const headingId = useId();
  return (
    <GlassPanel
      variant="muted"
      role="status"
      aria-live="polite"
      aria-labelledby={headingId}
      className={cn(PANEL_CLS, className)}
    >
      <AmbientGlow
        tone="sky"
        className="!inset-[-30%_-20%_auto_-20%] !w-[140%] !h-[80%] opacity-60"
      />
      <span aria-hidden="true" className="relative z-10 text-pearl-soft">
        <EmptyIcon />
      </span>
      {eyebrow ? <SpecLabel className="relative z-10">{eyebrow}</SpecLabel> : null}
      <h2 id={headingId} className={cn(HEADING_CLS, "relative z-10")}>
        {heading}
      </h2>
      {body ? <p className={cn(BODY_CLS, "relative z-10")}>{body}</p> : null}
      {action ? (
        <div className="relative z-10 flex flex-wrap items-center justify-center gap-3">
          <ActionButton action={action} />
          {secondary ? <ActionButton action={secondary} primary={false} /> : null}
        </div>
      ) : null}
    </GlassPanel>
  );
}

// ---- LoadingState ----
export function LoadingState({
  heading,
  body,
  eyebrow,
  className,
}: Omit<BaseProps, "action" | "secondary">): React.JSX.Element {
  const headingId = useId();
  return (
    <GlassPanel
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-labelledby={headingId}
      className={cn(PANEL_CLS, className)}
    >
      <AmbientGlow tone="sky" className="!inset-[-40%_-30%_auto_-30%] !w-[160%] !h-[80%] opacity-50" />
      <span className="relative z-10">
        <HairlineSpinner size={28} />
      </span>
      {eyebrow ? <SpecLabel className="relative z-10">{eyebrow}</SpecLabel> : null}
      <h2 id={headingId} className={cn(HEADING_CLS, "relative z-10")}>
        {heading}
      </h2>
      {body ? <p className={cn(BODY_CLS, "relative z-10")}>{body}</p> : null}
    </GlassPanel>
  );
}

// ---- ErrorState — copper-edged, but uses crimson hairline accent ----
export function ErrorState({
  heading,
  body,
  eyebrow,
  action,
  secondary,
  className,
}: BaseProps): React.JSX.Element {
  const headingId = useId();
  return (
    <GlassPanel
      role="alert"
      aria-live="assertive"
      aria-labelledby={headingId}
      className={cn(
        PANEL_CLS,
        "border-[var(--color-copper)]/40",
        className,
      )}
      style={{ borderColor: "rgba(201,163,106,0.36)" }}
    >
      <AmbientGlow tone="copper" className="!inset-[-30%_-20%_auto_-20%] !w-[140%] !h-[80%] opacity-50" />
      <span aria-hidden="true" className="relative z-10 text-[var(--color-copper)]">
        <ErrorIcon />
      </span>
      {eyebrow ? <SpecLabel className="relative z-10">{eyebrow}</SpecLabel> : null}
      <h2 id={headingId} className={cn(HEADING_CLS, "relative z-10")}>
        {heading}
      </h2>
      {body ? <p className={cn(BODY_CLS, "relative z-10")}>{body}</p> : null}
      <div
        aria-hidden="true"
        className="relative z-10 h-px w-32"
        style={{ background: "linear-gradient(90deg, transparent, var(--color-copper), transparent)" }}
      />
      {action ? (
        <div className="relative z-10 flex flex-wrap items-center justify-center gap-3">
          <ActionButton action={action} />
          {secondary ? <ActionButton action={secondary} primary={false} /> : null}
        </div>
      ) : null}
    </GlassPanel>
  );
}

// ---- SuccessState — anchored by a GoldSeal ----
export function SuccessState({
  heading,
  body,
  eyebrow,
  action,
  secondary,
  className,
}: BaseProps): React.JSX.Element {
  const headingId = useId();
  return (
    <GlassPanel
      role="status"
      aria-live="polite"
      aria-labelledby={headingId}
      className={cn(PANEL_CLS, className)}
    >
      <AmbientGlow tone="emerald" className="!inset-[-30%_-20%_auto_-20%] !w-[140%] !h-[80%] opacity-50" />
      <span className="relative z-10">
        <GoldSeal size={40} label="success" />
      </span>
      {eyebrow ? <SpecLabel className="relative z-10">{eyebrow}</SpecLabel> : null}
      <h2 id={headingId} className={cn(HEADING_CLS, "relative z-10")}>
        {heading}
      </h2>
      {body ? <p className={cn(BODY_CLS, "relative z-10")}>{body}</p> : null}
      {action ? (
        <div className="relative z-10 flex flex-wrap items-center justify-center gap-3">
          <ActionButton action={action} />
          {secondary ? <ActionButton action={secondary} primary={false} /> : null}
        </div>
      ) : null}
    </GlassPanel>
  );
}

// ---- inline icons (decorative, currentColor) ----
function EmptyIcon(): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 64 64"
      width="56"
      height="56"
    >
      <circle
        cx="32"
        cy="32"
        r="26"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeDasharray="3 5"
        opacity="0.6"
      />
      <path
        d="M20 36 L28 28 L36 36 L46 24"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.85"
      />
    </svg>
  );
}

function ErrorIcon(): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 64 64"
      width="56"
      height="56"
    >
      <circle cx="32" cy="32" r="26" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M32 18 L32 36" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="32" cy="44" r="1.75" fill="currentColor" />
    </svg>
  );
}
