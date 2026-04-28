"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useVoiceIntake } from "../../../lib/voice";
import { useReducedMotion } from "../../../lib/motion";
import { Button } from "../../../components/ui/Button";
import { Textarea } from "../../../components/ui/Form";
import { Alert } from "../../../components/ui/Form";

export function VoiceIntakeClient(): React.JSX.Element {
  const t = useTranslations();
  const [draft, setDraft] = useState<string>("");
  const reduced = useReducedMotion();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const { state, partial, level, error, start, stop, cancelTts } = useVoiceIntake({
    onPartial: (p) => setDraft(p),
    onFinal: (f) => setDraft(f),
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "oklch(20% 0.02 260)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const bars = 32;
    const cw = canvas.width / bars;
    for (let i = 0; i < bars; i++) {
      const phase = (i / bars) * Math.PI * 2;
      const amp = reduced
        ? 0.3
        : Math.max(0.1, Math.min(0.95, level * 6 + 0.1 * Math.sin(phase + Date.now() / 300)));
      const h = canvas.height * amp;
      ctx.fillStyle = "oklch(74% 0.16 200)";
      ctx.fillRect(i * cw + 1, (canvas.height - h) / 2, cw - 2, h);
    }
  }, [level, reduced]);

  return (
    <section className="space-y-6 py-6">
      <header className="space-y-1">
        <p className="text-muted text-sm uppercase tracking-[0.2em]">{t("voice.eyebrow")}</p>
        <h1 className="font-display text-3xl font-semibold">{t("voice.title")}</h1>
        <p className="text-muted">{t("voice.subtitle")}</p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          <div
            className="rounded-[var(--radius-card)] border border-muted/30 p-4"
            style={{ backgroundColor: "oklch(20% 0.02 260)" }}
          >
            <p className="text-xs uppercase tracking-wide text-muted">{t("voice.waveformLabel")}</p>
            <canvas
              ref={canvasRef}
              width={640}
              height={120}
              role="img"
              aria-label={t("voice.waveformLabel")}
              className="mt-2 h-32 w-full"
            />
            <p
              role="status"
              aria-live="polite"
              className="mt-3 min-h-[2rem] text-sm text-muted"
            >
              {state === "listening"
                ? t("voice.state.listening")
                : state === "thinking"
                  ? t("voice.state.thinking")
                  : state === "speaking"
                    ? t("voice.state.speaking")
                    : state === "error"
                      ? t("voice.state.error")
                      : t("voice.state.idle")}
            </p>
          </div>

          <div>
            <label htmlFor="transcript" className="text-sm font-medium">
              {t("voice.transcriptLabel")}
            </label>
            <Textarea
              id="transcript"
              value={partial || draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={4}
              className="mt-1"
              placeholder={t("voice.transcriptPlaceholder")}
            />
          </div>

          {error ? <Alert tone="danger" title={t("voice.state.error")}>{error}</Alert> : null}

          <div className="flex flex-wrap gap-3">
            <Button
              variant="primary"
              size="lg"
              onClick={() => void start()}
              loading={state === "listening" || state === "thinking"}
              loadingText={t("voice.button.listening")}
            >
              {t("voice.button.start")}
            </Button>
            <Button variant="outline" onClick={() => stop()}>
              {t("voice.button.stop")}
            </Button>
            <Button variant="ghost" onClick={() => cancelTts()}>
              {t("voice.button.silence")}
            </Button>
          </div>
        </div>

        <aside
          className="space-y-2 rounded-[var(--radius-card)] border border-muted/30 p-4 text-sm"
          style={{ backgroundColor: "oklch(20% 0.02 260)" }}
        >
          <h2 className="font-display text-lg font-semibold">{t("voice.tipsTitle")}</h2>
          <ul className="list-disc space-y-1 pl-4 text-muted">
            <li>{t("voice.tips.environment")}</li>
            <li>{t("voice.tips.bargein")}</li>
            <li>{t("voice.tips.edit")}</li>
          </ul>
        </aside>
      </div>
    </section>
  );
}
