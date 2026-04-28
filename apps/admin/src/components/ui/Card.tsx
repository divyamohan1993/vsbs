import type { ReactNode } from "react";

interface CardProps {
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  ariaLabel?: string;
}

export function Card({ title, description, children, actions, ariaLabel }: CardProps) {
  return (
    <section
      aria-label={ariaLabel}
      className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-surface-2"
    >
      {title || description || actions ? (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--color-border)] px-5 py-4">
          <div>
            {title ? (
              <div className="font-display text-lg font-semibold">{title}</div>
            ) : null}
            {description ? (
              <div className="text-muted text-sm">{description}</div>
            ) : null}
          </div>
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className="p-5">{children}</div>
    </section>
  );
}
