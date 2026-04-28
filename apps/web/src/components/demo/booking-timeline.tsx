// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Divya Mohan / dmj.one
"use client";

export interface TimelineStep {
  key: string;
  label: string;
  description?: string | undefined;
  state: "pending" | "active" | "done" | "failed";
  at?: string | undefined;
}

const STATE_BORDER = {
  pending: "border-muted/30 text-muted",
  active: "border-accent text-on-surface",
  done: "border-success text-on-surface",
  failed: "border-danger text-danger",
} as const;

export function BookingTimeline({
  steps,
  ariaLabel,
}: {
  steps: TimelineStep[];
  ariaLabel: string;
}): React.JSX.Element {
  return (
    <ol aria-label={ariaLabel} className="grid gap-3 md:grid-cols-2">
      {steps.map((step) => (
        <li
          key={step.key}
          aria-current={step.state === "active" ? "step" : undefined}
          className={`rounded-[var(--radius-card)] border-2 px-4 py-3 ${STATE_BORDER[step.state]}`}
        >
          <div className="text-xs uppercase tracking-wider opacity-80">{step.state}</div>
          <div className="font-display text-lg font-semibold">{step.label}</div>
          {step.at ? (
            <div className="text-xs text-muted">{step.at}</div>
          ) : null}
          {step.description ? (
            <div className="mt-1 text-sm">{step.description}</div>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
