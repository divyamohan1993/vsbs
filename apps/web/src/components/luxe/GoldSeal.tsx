// GoldSeal — a small circular mark used to denote a signed, witnessed, or
// otherwise "earned" item. Copper accent ring, with a small inner dot and an
// accessible name. Use sparingly — its weight comes from rarity.

import { cn } from "../ui/cn";

export interface GoldSealProps {
  label?: string;
  size?: number;
  className?: string;
}

export function GoldSeal({ label = "verified", size = 24, className }: GoldSealProps): React.JSX.Element {
  return (
    <span
      role="img"
      aria-label={label}
      className={cn("relative inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: size, height: size, minWidth: size, minHeight: size }}
    >
      <span
        aria-hidden="true"
        className="absolute inset-0 rounded-full"
        style={{
          background:
            "conic-gradient(from 30deg, #C9A36A, #F1D9A3, #A07E48, #C9A36A)",
          padding: 1,
          mask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
          WebkitMask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
          maskComposite: "exclude",
          WebkitMaskComposite: "xor",
        }}
      />
      <span
        aria-hidden="true"
        className="rounded-full"
        style={{
          width: size * 0.34,
          height: size * 0.34,
          background:
            "radial-gradient(circle, #F1D9A3 0%, #C9A36A 60%, #A07E48 100%)",
          boxShadow: "0 0 8px rgba(201, 163, 106, 0.6)",
        }}
      />
    </span>
  );
}
