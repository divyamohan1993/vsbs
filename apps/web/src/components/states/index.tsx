// EmptyState / LoadingState / ErrorState / SuccessState — reusable
// surfaces. The illustrations are decorative; the heading + body carry
// the semantics.

import { useId, type ReactNode } from "react";
import { Button } from "../ui/Button";
import { cn } from "../ui/cn";
import {
  EmptyIllustration,
  ErrorIllustration,
  LoadingIllustration,
  SuccessIllustration,
} from "./illustrations";

interface BaseProps {
  heading: string;
  body?: ReactNode;
  action?: { label: string; onClick: () => void } | { label: string; href: string };
  className?: string;
}

function StateShell({
  heading,
  body,
  action,
  className,
  illustration,
  tone,
  headingId,
}: BaseProps & {
  illustration: React.JSX.Element;
  tone: "neutral" | "danger" | "success" | "muted";
  headingId: string;
}): React.JSX.Element {
  const toneClass: Record<typeof tone, string> = {
    neutral: "text-on-surface",
    danger: "text-danger",
    success: "text-success",
    muted: "text-muted",
  };
  return (
    <section
      role={tone === "danger" ? "alert" : "status"}
      aria-live={tone === "danger" ? "assertive" : "polite"}
      aria-labelledby={headingId}
      className={cn(
        "flex flex-col items-center gap-4 rounded-[var(--radius-card)] border border-muted/30 p-8 text-center",
        className,
      )}
      style={{ backgroundColor: "oklch(18% 0.02 260)" }}
    >
      <span aria-hidden="true" className={cn("inline-flex", toneClass[tone])}>
        {illustration}
      </span>
      <div className="space-y-1">
        <h2 id={headingId} className="font-display text-xl font-semibold text-on-surface">
          {heading}
        </h2>
        {body ? <div className="text-on-surface/85">{body}</div> : null}
      </div>
      {action ? (
        "href" in action ? (
          <a
            href={action.href}
            className="inline-flex items-center justify-center rounded-[var(--radius-card)] bg-accent px-5 py-2 text-sm font-semibold text-accent-on"
          >
            {action.label}
          </a>
        ) : (
          <Button onClick={action.onClick} variant="primary">
            {action.label}
          </Button>
        )
      ) : null}
    </section>
  );
}

export function EmptyState(props: BaseProps): React.JSX.Element {
  const id = useId();
  return <StateShell {...props} tone="muted" illustration={<EmptyIllustration />} headingId={id} />;
}

export function LoadingState(props: BaseProps): React.JSX.Element {
  const id = useId();
  return <StateShell {...props} tone="neutral" illustration={<LoadingIllustration />} headingId={id} />;
}

export function ErrorState(props: BaseProps): React.JSX.Element {
  const id = useId();
  return <StateShell {...props} tone="danger" illustration={<ErrorIllustration />} headingId={id} />;
}

export function SuccessState(props: BaseProps): React.JSX.Element {
  const id = useId();
  return <StateShell {...props} tone="success" illustration={<SuccessIllustration />} headingId={id} />;
}
