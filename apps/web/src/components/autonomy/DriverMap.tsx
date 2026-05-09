"use client";

// Horizontal route map — shows phases as colored segments, scheduled
// red lights / construction / incidents / service centre as icons,
// and an animated ego marker at the current route progress.

import type { TelemetryFrame } from "./useTelemetryStream";
import { GlassPanel } from "../luxe";
import { cn } from "../ui/cn";

type Waypoint = { frac: number; label: string; kind: string };

interface DriverMapProps {
  frame: TelemetryFrame & {
    routeProgress?: number;
    routeWaypoints?: Waypoint[];
    routeTotalKm?: number;
    distanceTraveledKm?: number;
  };
  className?: string;
}

const WP_COLOR: Record<string, string> = {
  origin: "#c9a36a",
  redlight: "#e11d48",
  construction: "#f59e0b",
  incident: "#a855f7",
  destination: "#10b981",
};

const WP_ICON: Record<string, string> = {
  origin: "⌂",
  redlight: "●",
  construction: "▲",
  incident: "✷",
  destination: "■",
};

export function DriverMap({ frame, className }: DriverMapProps): React.JSX.Element {
  const progress = frame.routeProgress ?? 0;
  const waypoints = frame.routeWaypoints ?? [];
  const total = frame.routeTotalKm ?? 12.3;
  const traveled = frame.distanceTraveledKm ?? 0;

  // SVG layout: 1100 wide, 100 tall. Route line at y=50, padded 40 px each side.
  const W = 1100;
  const H = 100;
  const PAD = 50;
  const lineY = 56;
  const x = (frac: number) => PAD + (W - 2 * PAD) * Math.max(0, Math.min(1, frac));

  return (
    <GlassPanel variant="muted" className={cn("p-5", className)} aria-label="Route map">
      <div className="mb-3 flex items-baseline justify-between">
        <div className="luxe-mono text-[length:var(--text-micro)] uppercase tracking-[var(--tracking-caps)] text-pearl-muted">
          Route map &nbsp;·&nbsp; live ego position
        </div>
        <div className="luxe-mono text-[length:var(--text-micro)] tabular-nums text-pearl-soft">
          {traveled.toFixed(2)} / {total.toFixed(1)} km · {(progress * 100).toFixed(0)} %
        </div>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto"
        role="img"
        aria-label="Route progress with constraints"
      >
        {/* Base road line */}
        <line
          x1={PAD}
          x2={W - PAD}
          y1={lineY}
          y2={lineY}
          stroke="rgba(255,255,255,0.15)"
          strokeWidth={6}
          strokeLinecap="round"
        />
        {/* Traveled-so-far progress */}
        <line
          x1={PAD}
          x2={x(progress)}
          y1={lineY}
          y2={lineY}
          stroke="#c9a36a"
          strokeWidth={6}
          strokeLinecap="round"
        />
        {/* Tick marks every 10% */}
        {Array.from({ length: 11 }, (_, i) => i * 0.1).map((frac) => (
          <line
            key={`tick-${frac}`}
            x1={x(frac)}
            x2={x(frac)}
            y1={lineY + 8}
            y2={lineY + 14}
            stroke="rgba(255,255,255,0.3)"
            strokeWidth={1}
          />
        ))}
        {/* Waypoint markers */}
        {waypoints.map((w, i) => (
          <g key={`wp-${i}`} transform={`translate(${x(w.frac)},${lineY - 18})`}>
            <circle r={11} fill="rgba(10,12,17,0.85)" stroke={WP_COLOR[w.kind] ?? "#888"} strokeWidth={2} />
            <text
              x={0}
              y={5}
              textAnchor="middle"
              fontSize={13}
              fill={WP_COLOR[w.kind] ?? "#888"}
              fontFamily="monospace"
              fontWeight={600}
            >
              {WP_ICON[w.kind] ?? "•"}
            </text>
            <text
              x={0}
              y={42}
              textAnchor="middle"
              fontSize={10}
              fill="rgba(245,245,245,0.65)"
              fontFamily="monospace"
              style={{ textTransform: "uppercase", letterSpacing: "0.06em" }}
            >
              {w.label}
            </text>
          </g>
        ))}
        {/* Ego marker */}
        <g transform={`translate(${x(progress)},${lineY})`}>
          <circle r={8} fill="#10b981" stroke="#0a0c11" strokeWidth={2} />
          <circle r={14} fill="none" stroke="#10b981" strokeWidth={1} opacity={0.45}>
            <animate attributeName="r" values="14;22;14" dur="1.6s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.55;0;0.55" dur="1.6s" repeatCount="indefinite" />
          </circle>
        </g>
      </svg>
    </GlassPanel>
  );
}
