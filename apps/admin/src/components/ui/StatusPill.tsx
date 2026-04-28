interface StatusPillProps {
  tone: "success" | "warn" | "danger" | "info" | "muted";
  children: React.ReactNode;
}

const CLASS: Record<StatusPillProps["tone"], string> = {
  success: "bg-success text-success-on",
  warn: "bg-warn text-warn-on",
  danger: "bg-danger text-danger-on",
  info: "bg-accent text-accent-on",
  muted: "bg-surface-3 text-on-surface",
};

export function StatusPill({ tone, children }: StatusPillProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-0.5 text-xs font-semibold ${CLASS[tone]}`}
    >
      {children}
    </span>
  );
}
