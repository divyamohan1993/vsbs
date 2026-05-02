// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Divya Mohan / dmj.one

// Pure formatting helpers shared by every recordings UI surface.
//
// prettyBytes: 1.0 KB / 12.4 MB / 1.8 GB at one decimal place.
// prettyDuration: MM:SS, zero-padded, never negative, always two-digit minutes.
// prettyTime: HH:MM:SS in the viewer's locale, defensive on malformed input.
// shortId: first eight characters of a uuid, useful for the live banner.

const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;

export function prettyBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0 B";
  if (n < KB) return `${n} B`;
  if (n < MB) return `${(n / KB).toFixed(1)} KB`;
  if (n < GB) return `${(n / MB).toFixed(1)} MB`;
  return `${(n / GB).toFixed(1)} GB`;
}

export function prettyDuration(s: number): string {
  const safe = Number.isFinite(s) && s > 0 ? Math.floor(s) : 0;
  const m = Math.floor(safe / 60);
  const r = safe % 60;
  return `${pad2(m)}:${pad2(r)}`;
}

export function prettyTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--:--:--";
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

export function shortId(id: string): string {
  if (typeof id !== "string") return "";
  return id.slice(0, 8);
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
