"use client";

// The visible output of one concierge turn. We POST the user message
// to /api/proxy/concierge/turn and stream the AgentEvents back, rendering
// each tool call, verifier verdict, tool result, delta, and final message
// as it arrives. This is the operational-transparency principle from
// Buell & Norton 2011 — show the work being done, don't hide it.

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { readSse } from "../../lib/sse.js";

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

interface ConciergeRunnerProps {
  conversationId: string;
  userMessage: string;
}

export function ConciergeRunner({
  conversationId,
  userMessage,
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

  return (
    <section
      aria-labelledby="concierge-h"
      className="space-y-4 rounded-[var(--radius-card)] border border-muted/30 p-6"
    >
      <div className="flex items-center justify-between">
        <h2 id="concierge-h" className="font-display text-2xl font-semibold">
          {t("concierge.title")}
        </h2>
        <span
          className="text-xs uppercase tracking-wider text-muted"
          aria-live="polite"
        >
          {running ? t("concierge.running") : error ? t("concierge.failed") : t("concierge.done")}
        </span>
      </div>

      <p className="text-muted">{t("concierge.subtitle")}</p>

      <ol className="space-y-2" aria-label={t("concierge.traceLabel")}>
        {events.map((ev, i) => (
          <li
            key={`${ev.type}-${i}`}
            className="rounded-[var(--radius-card)] border border-muted/20 px-4 py-3"
          >
            <EventRow ev={ev} t={t} />
          </li>
        ))}
      </ol>

      {finalMessage ? (
        <div
          role="status"
          aria-live="polite"
          className="rounded-[var(--radius-card)] border-2 border-accent bg-[oklch(20%_0.04_200)] p-5 text-on-surface"
        >
          <p className="mb-2 text-xs uppercase tracking-wider text-muted">
            {t("concierge.finalEyebrow")}
          </p>
          <p className="whitespace-pre-wrap text-base">{finalMessage}</p>
        </div>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="rounded-[var(--radius-card)] border-2 border-danger px-4 py-3 text-on-surface"
        >
          {error}
        </div>
      ) : null}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => {
            ranRef.current = false;
            void run();
          }}
          disabled={running}
          className="inline-flex items-center justify-center rounded-[var(--radius-card)] border border-muted/40 px-4 py-2 text-sm font-medium"
        >
          {t("concierge.rerun")}
        </button>
      </div>
    </section>
  );
}

function EventRow({
  ev,
  t,
}: {
  ev: ConciergeEvent;
  t: ReturnType<typeof useTranslations>;
}): React.JSX.Element {
  switch (ev.type) {
    case "tool-call": {
      const call = ev.call as { name?: string } | undefined;
      return (
        <Row eyebrow={t("concierge.rows.toolCall")} title={call?.name ?? "tool"} detail={t("concierge.rows.toolCallBody")} />
      );
    }
    case "verifier": {
      const verdict = ev.verdict as { grounded?: boolean; reason?: string } | undefined;
      return (
        <Row
          eyebrow={t("concierge.rows.verifier")}
          title={verdict?.grounded ? t("concierge.rows.verifierGrounded") : t("concierge.rows.verifierRejected")}
          detail={verdict?.reason ?? ""}
        />
      );
    }
    case "tool-result": {
      const result = ev.result as
        | { ok?: boolean; toolName?: string; reason?: string; data?: unknown }
        | undefined;
      const ok = result?.ok === true;
      return (
        <Row
          eyebrow={t("concierge.rows.toolResult")}
          title={`${result?.toolName ?? "tool"} — ${ok ? t("concierge.rows.resultOk") : t("concierge.rows.resultFail")}`}
          detail={ok ? safeStringify(result?.data) : result?.reason ?? ""}
        />
      );
    }
    case "delta":
      return (
        <Row
          eyebrow={t("concierge.rows.delta")}
          title={t("concierge.rows.deltaBody")}
          detail={(ev as { text?: string }).text ?? ""}
        />
      );
    case "final":
      return <Row eyebrow={t("concierge.rows.final")} title={t("concierge.rows.finalBody")} detail="" />;
    case "error":
      return (
        <Row
          eyebrow={t("concierge.rows.error")}
          title={(ev as { code?: string }).code ?? "error"}
          detail={(ev as { message?: string }).message ?? ""}
        />
      );
    default:
      return <Row eyebrow={ev.type} title="" detail="" />;
  }
}

function Row({
  eyebrow,
  title,
  detail,
}: {
  eyebrow: string;
  title: string;
  detail: string;
}): React.JSX.Element {
  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-muted">{eyebrow}</p>
      {title ? <p className="font-medium text-on-surface">{title}</p> : null}
      {detail ? (
        <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted">{detail}</p>
      ) : null}
    </div>
  );
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
