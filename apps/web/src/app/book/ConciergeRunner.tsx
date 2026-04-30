"use client";

// The visible output of one concierge turn. We POST the user message to
// /api/proxy/concierge/turn and stream the AgentEvents back, rendering each
// tool call, verifier verdict, tool result, delta, and final message as it
// arrives. The chrome is luxe-grade: hairline rows with mono ids on the left
// and serif content on the right, status dots, a copper "Done." card on
// success, and a copper-edged advisory card if the C3 output filter returned
// the canonical "I cannot certify safety; please consult a qualified
// mechanic." line.

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { readSse } from "../../lib/sse";
import { GlassPanel, GoldSeal, SpecLabel } from "../../components/luxe";
import { Button } from "../../components/ui/Button";

interface ConciergeEvent {
  type:
    | "tool-call"
    | "verifier"
    | "tool-result"
    | "delta"
    | "final"
    | "error"
    | "end"
    | "safety"
    | "dispatch"
    | "autonomy";
  [k: string]: unknown;
}

export interface ConciergeRunnerProps {
  conversationId: string;
  userMessage: string;
  bookingId?: string;
  canonicalNoSafetyAdvisory?: string;
}

export function ConciergeRunner({
  conversationId,
  userMessage,
  bookingId,
  canonicalNoSafetyAdvisory,
}: ConciergeRunnerProps): React.JSX.Element {
  const t = useTranslations();
  const [events, setEvents] = useState<ConciergeEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [finalMessage, setFinalMessage] = useState<string | null>(null);
  const ranRef = useRef(false);

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    setEvents([]);
    setFinalMessage(null);
    try {
      const res = await fetch("/api/proxy/concierge/turn", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId, userMessage }),
      });
      if (!res.ok) {
        throw new Error(`Concierge failed (${res.status})`);
      }
      for await (const frame of readSse(res.body)) {
        if (frame.event === "end") break;
        try {
          const ev = JSON.parse(frame.data) as ConciergeEvent;
          setEvents((prev) => [...prev, ev]);
          if (ev.type === "final") {
            const msg = (ev.message as { content?: string } | undefined)?.content;
            if (typeof msg === "string") setFinalMessage(msg);
          }
          if (ev.type === "error") {
            const m = (ev as { message?: string }).message;
            setError(typeof m === "string" ? m : "concierge error");
          }
        } catch {
          /* ignore malformed frame */
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }, [conversationId, userMessage]);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    void run();
  }, [run]);

  const isCanonicalAdvisory =
    finalMessage !== null &&
    canonicalNoSafetyAdvisory !== undefined &&
    finalMessage.trim() === canonicalNoSafetyAdvisory.trim();

  const status = running
    ? t("concierge.running")
    : error
      ? t("concierge.failed")
      : t("concierge.done");

  return (
    <section
      aria-labelledby="concierge-h"
      className="space-y-6"
    >
      <GlassPanel variant="elevated" className="space-y-5">
        <header className="flex items-center justify-between">
          <div className="space-y-1">
            <SpecLabel>{t("concierge.eyebrow")}</SpecLabel>
            <h3
              id="concierge-h"
              className="font-[family-name:var(--font-display)] text-[var(--text-h4)] font-medium tracking-[var(--tracking-tight)] text-pearl"
            >
              {t("concierge.title")}
            </h3>
          </div>
          <div className="flex items-center gap-2" aria-live="polite">
            <span
              aria-hidden="true"
              className={[
                "inline-block h-2 w-2 rounded-full",
                running ? "vsbs-concierge-pulse" : "",
              ].join(" ")}
              style={{
                backgroundColor: running
                  ? "var(--color-accent-sky)"
                  : error
                    ? "var(--color-crimson)"
                    : "var(--color-emerald)",
                boxShadow: running
                  ? "0 0 12px rgba(79,183,255,0.55)"
                  : "none",
              }}
            />
            <span className="luxe-mono text-[var(--text-caption)] uppercase tracking-[var(--tracking-wider)] text-pearl-soft">
              {status}
            </span>
          </div>
        </header>

        <p className="text-[var(--text-control)] leading-[1.6] text-pearl-muted">
          {t("concierge.subtitle")}
        </p>

        <ol
          role="log"
          aria-live="polite"
          aria-label={t("concierge.traceLabel")}
          className="divide-y divide-[var(--color-hairline)]"
        >
          {events.length === 0 ? (
            <li className="py-4 text-[var(--text-caption)] text-pearl-soft">
              {t("concierge.waiting")}
            </li>
          ) : (
            events.map((ev, i) => (
              <li key={`${ev.type}-${i}`} className="py-4">
                <EventRow ev={ev} t={t} />
              </li>
            ))
          )}
        </ol>
      </GlassPanel>

      {finalMessage && !isCanonicalAdvisory ? (
        <DonePanel
          t={t}
          message={finalMessage}
          {...(bookingId !== undefined ? { bookingId } : {})}
        />
      ) : null}

      {finalMessage && isCanonicalAdvisory ? (
        <CopperAdvisoryPanel
          t={t}
          message={finalMessage}
          {...(bookingId !== undefined ? { bookingId } : {})}
        />
      ) : null}

      {error ? (
        <GlassPanel
          className="border border-[var(--color-crimson)] bg-[rgba(178,58,72,0.08)]"
          role="alert"
        >
          <p className="text-[var(--text-control)] text-pearl">{error}</p>
          <div className="mt-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                ranRef.current = false;
                void run();
              }}
            >
              {t("concierge.rerun")}
            </Button>
          </div>
        </GlassPanel>
      ) : null}
    </section>
  );
}

function DonePanel({
  t,
  message,
  bookingId,
}: {
  t: ReturnType<typeof useTranslations>;
  message: string;
  bookingId?: string;
}): React.JSX.Element {
  return (
    <GlassPanel
      variant="elevated"
      className="vsbs-concierge-rise border border-[var(--color-copper)]"
    >
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <GoldSeal size={28} label={t("concierge.doneSealLabel")} />
          <SpecLabel>{t("concierge.finalEyebrow")}</SpecLabel>
        </div>
        <p className="font-[family-name:var(--font-display)] text-[var(--text-h3)] leading-[1.2] tracking-[var(--tracking-tight)] text-pearl">
          {t("concierge.done")}
        </p>
        <p className="whitespace-pre-wrap text-[var(--text-control)] leading-[1.7] text-pearl-muted">
          {message}
        </p>
        {bookingId ? (
          <div className="flex flex-col gap-2 border-t border-[var(--color-hairline)] pt-4 md:flex-row md:items-center md:justify-between">
            <div>
              <SpecLabel>{t("book.step5.bookingId")}</SpecLabel>
              <p className="luxe-mono mt-1 text-pearl">{bookingId}</p>
            </div>
            <Link
              href={{ pathname: `/autonomy/${bookingId}` }}
              className="luxe-btn-primary inline-flex min-h-[56px] items-center justify-center rounded-[var(--radius-md)] px-7 py-3 text-[var(--text-body)] font-medium tracking-[var(--tracking-wide)]"
            >
              {t("book.step5.openDashboard")}
            </Link>
          </div>
        ) : null}
      </div>
    </GlassPanel>
  );
}

function CopperAdvisoryPanel({
  t,
  message,
  bookingId,
}: {
  t: ReturnType<typeof useTranslations>;
  message: string;
  bookingId?: string;
}): React.JSX.Element {
  return (
    <GlassPanel
      variant="elevated"
      role="status"
      aria-live="polite"
      className="border border-[var(--color-copper)]"
    >
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <GoldSeal size={24} label={t("concierge.advisorySealLabel")} />
          <SpecLabel>{t("concierge.advisoryEyebrow")}</SpecLabel>
        </div>
        <p className="font-[family-name:var(--font-display)] text-[var(--text-h4)] leading-[1.3] tracking-[var(--tracking-tight)] text-pearl">
          {message}
        </p>
        <p className="text-[var(--text-control)] leading-[1.6] text-pearl-muted">
          {t("concierge.advisoryBody")}
        </p>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-end">
          {bookingId ? (
            <Link
              href={{ pathname: `/status/${bookingId}` }}
              className="inline-flex min-h-[44px] items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-hairline-strong)] px-5 py-2 text-[var(--text-control)] tracking-[var(--tracking-wide)] text-pearl hover:[border-color:var(--color-copper)]"
            >
              {t("concierge.viewBooking")}
            </Link>
          ) : null}
          <a
            href="tel:+918001112233"
            className="luxe-btn-primary inline-flex min-h-[56px] items-center justify-center rounded-[var(--radius-md)] px-7 py-3 text-[var(--text-body)] font-medium tracking-[var(--tracking-wide)]"
          >
            {t("concierge.arrangeTow")}
          </a>
        </div>
      </div>
    </GlassPanel>
  );
}

function EventRow({
  ev,
  t,
}: {
  ev: ConciergeEvent;
  t: ReturnType<typeof useTranslations>;
}): React.JSX.Element {
  const meta = describe(ev, t);
  return (
    <div className="grid grid-cols-[120px_1fr] items-start gap-4">
      <div className="flex items-center gap-2 pt-0.5">
        <span
          aria-hidden="true"
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: meta.dot }}
        />
        <span className="luxe-mono text-[var(--text-caption)] uppercase tracking-[var(--tracking-wider)] text-pearl-soft">
          {meta.tag}
        </span>
      </div>
      <div className="space-y-1">
        {meta.title ? (
          <p className="font-[family-name:var(--font-display)] text-[var(--text-h4)] leading-[1.25] tracking-[var(--tracking-tight)] text-pearl">
            {meta.title}
          </p>
        ) : null}
        {meta.detail ? (
          <p className="text-[var(--text-control)] leading-[1.6] text-pearl-muted">
            {meta.detail}
          </p>
        ) : null}
      </div>
    </div>
  );
}

interface RowMeta {
  tag: string;
  title: string;
  detail: string;
  dot: string;
}

function describe(
  ev: ConciergeEvent,
  t: ReturnType<typeof useTranslations>,
): RowMeta {
  const ok = "var(--color-emerald)";
  const sky = "var(--color-accent-sky)";
  const copper = "var(--color-copper)";
  const crimson = "var(--color-crimson)";
  const muted = "var(--color-pearl-soft)";

  switch (ev.type) {
    case "tool-call": {
      const call = ev.call as { name?: string } | undefined;
      return {
        tag: t("concierge.rows.toolCall"),
        title: call?.name ?? "tool",
        detail: t("concierge.rows.toolCallBody"),
        dot: sky,
      };
    }
    case "verifier": {
      const verdict = ev.verdict as { grounded?: boolean; reason?: string } | undefined;
      return {
        tag: t("concierge.rows.verifier"),
        title: verdict?.grounded
          ? t("concierge.rows.verifierGrounded")
          : t("concierge.rows.verifierRejected"),
        detail: verdict?.reason ?? "",
        dot: verdict?.grounded ? copper : crimson,
      };
    }
    case "tool-result": {
      const result = ev.result as
        | { ok?: boolean; toolName?: string; reason?: string; data?: unknown }
        | undefined;
      const okFlag = result?.ok === true;
      return {
        tag: t("concierge.rows.toolResult"),
        title: `${result?.toolName ?? "tool"} — ${
          okFlag ? t("concierge.rows.resultOk") : t("concierge.rows.resultFail")
        }`,
        detail: okFlag ? safeStringify(result?.data) : result?.reason ?? "",
        dot: okFlag ? ok : crimson,
      };
    }
    case "delta": {
      return {
        tag: t("concierge.rows.delta"),
        title: t("concierge.rows.deltaBody"),
        detail: (ev as { text?: string }).text ?? "",
        dot: muted,
      };
    }
    case "final": {
      return {
        tag: t("concierge.rows.final"),
        title: t("concierge.rows.finalBody"),
        detail: "",
        dot: ok,
      };
    }
    case "error": {
      return {
        tag: t("concierge.rows.error"),
        title: (ev as { code?: string }).code ?? "error",
        detail: (ev as { message?: string }).message ?? "",
        dot: crimson,
      };
    }
    default: {
      return { tag: ev.type, title: "", detail: "", dot: muted };
    }
  }
}

function safeStringify(v: unknown): string {
  if (v === undefined) return "";
  try {
    const s = JSON.stringify(v);
    return s.length > 400 ? `${s.slice(0, 400)}…` : s;
  } catch {
    return String(v);
  }
}
