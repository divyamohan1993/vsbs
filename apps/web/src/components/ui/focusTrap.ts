"use client";

// Minimal focus trap for modal-like surfaces (Dialog, Drawer, Sheet).
// Inspired by Radix' DialogContent: cycles Tab / Shift+Tab through the
// focusable descendants of `container` and never escapes.

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type=\"hidden\"])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex=\"-1\"])",
  "[contenteditable=\"true\"]",
  "audio[controls]",
  "video[controls]",
].join(",");

export function getFocusable(container: HTMLElement): HTMLElement[] {
  const all = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  return all.filter((el) => {
    if (el.hidden) return false;
    if (el.getAttribute("aria-hidden") === "true") return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) {
      // Could be display:none; check computed styles when DOM allows.
      const style = typeof window !== "undefined" ? window.getComputedStyle(el) : null;
      if (style && (style.display === "none" || style.visibility === "hidden")) return false;
    }
    return true;
  });
}

export function trapFocus(container: HTMLElement, ev: KeyboardEvent): void {
  if (ev.key !== "Tab") return;
  const items = getFocusable(container);
  if (items.length === 0) {
    ev.preventDefault();
    container.focus();
    return;
  }
  const first = items[0]!;
  const last = items[items.length - 1]!;
  const active = document.activeElement as HTMLElement | null;
  if (ev.shiftKey) {
    if (active === first || !container.contains(active)) {
      ev.preventDefault();
      last.focus();
    }
  } else {
    if (active === last) {
      ev.preventDefault();
      first.focus();
    }
  }
}
