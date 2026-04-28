"use client";

import { useEffect, useState } from "react";

// Motion utilities. Reduced motion is honoured via the OS-level
// `prefers-reduced-motion` media query; CSS already short-circuits all
// transitions globally, but components that drive JS-side animation
// should still consult `useReducedMotion()` to skip work entirely.

export type MotionEase =
  | "linear"
  | "in-quint"
  | "out-quint"
  | "in-out-quint"
  | "in-cubic"
  | "out-cubic"
  | "in-out-cubic";

export const MOTION_EASE: Record<MotionEase, string> = {
  linear: "cubic-bezier(0,0,1,1)",
  "in-cubic": "cubic-bezier(0.32,0,0.67,0)",
  "out-cubic": "cubic-bezier(0.33,1,0.68,1)",
  "in-out-cubic": "cubic-bezier(0.65,0,0.35,1)",
  "in-quint": "cubic-bezier(0.64,0,0.78,0)",
  "out-quint": "cubic-bezier(0.22,1,0.36,1)",
  "in-out-quint": "cubic-bezier(0.83,0,0.17,1)",
};

export function motionEase(ease: MotionEase): string {
  return MOTION_EASE[ease];
}

export const MOTION_DURATIONS = {
  fast: 150,
  base: 200,
  slow: 300,
} as const;

export type MotionDuration = keyof typeof MOTION_DURATIONS;

export function motionDuration(d: MotionDuration): number {
  return MOTION_DURATIONS[d];
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = (): void => setReduced(mq.matches);
    if ("addEventListener" in mq) mq.addEventListener("change", onChange);
    else (mq as MediaQueryList & { addListener: (cb: () => void) => void }).addListener(onChange);
    return () => {
      if ("removeEventListener" in mq) mq.removeEventListener("change", onChange);
      else (mq as MediaQueryList & { removeListener: (cb: () => void) => void }).removeListener(onChange);
    };
  }, []);
  return reduced;
}
