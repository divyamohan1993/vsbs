// Inline SVG illustrations for the state components. All decorative —
// the surrounding state component carries the semantic message.

interface Props {
  className?: string;
}

export function EmptyIllustration({ className }: Props): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 96 96"
      width="96"
      height="96"
      className={className}
    >
      <circle cx="48" cy="48" r="40" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="4 4" opacity="0.4" />
      <path d="M28 56 L40 44 L52 56 L68 40" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" />
    </svg>
  );
}

export function LoadingIllustration({ className }: Props): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 96 96"
      width="96"
      height="96"
      className={className}
    >
      <circle cx="48" cy="48" r="36" fill="none" stroke="currentColor" strokeWidth="3" opacity="0.2" />
      <path
        d="M48 12 a36 36 0 0 1 36 36"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      >
        <animateTransform
          attributeName="transform"
          type="rotate"
          from="0 48 48"
          to="360 48 48"
          dur="1.2s"
          repeatCount="indefinite"
        />
      </path>
    </svg>
  );
}

export function ErrorIllustration({ className }: Props): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 96 96"
      width="96"
      height="96"
      className={className}
    >
      <circle cx="48" cy="48" r="40" fill="none" stroke="currentColor" strokeWidth="3" />
      <path d="M32 32 L64 64 M64 32 L32 64" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

export function SuccessIllustration({ className }: Props): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 96 96"
      width="96"
      height="96"
      className={className}
    >
      <circle cx="48" cy="48" r="40" fill="none" stroke="currentColor" strokeWidth="3" />
      <path d="M30 50 L44 64 L68 36" stroke="currentColor" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
