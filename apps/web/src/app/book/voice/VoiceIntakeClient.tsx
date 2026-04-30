"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useVoiceIntake } from "../../../lib/voice";
import { useReducedMotion } from "../../../lib/motion";
import { Button } from "../../../components/ui/Button";
import { Textarea } from "../../../components/ui/Form";
import { Alert } from "../../../components/ui/Form";
import { GlassPanel, SpecLabel } from "../../../components/luxe";

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
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const bars = 48;
    const cw = canvas.width / bars;
    for (let i = 0; i < bars; i++) {
      const phase = (i / bars) * Math.PI * 2;
      const amp = reduced
        ? 0.25
        : Math.max(0.08, Math.min(0.95, level * 5 + 0.08 * Math.sin(phase + Date.now() / 320)));
      const h = canvas.height * amp;
      ctx.fillStyle =
        state === "listening"
          ? "rgba(79, 183, 255, 0.85)"
          : "rgba(242, 238, 230, 0.45)";
      ctx.fillRect(i * cw + 1, (canvas.height - h) / 2, cw - 2, h);
    }
  }, [level, reduced, state]);

  return (
    <section className="mx-auto w-full max-w-[1180px] space-y-10 px-6 py-[56px] md:py-[120px]">
      <header className="space-y-3">
        <SpecLabel>{t("voice.eyebrow")}</SpecLabel>
        <h1 className="font-[family-name:var(--font-display)] text-[var(--text-h1)] font-medium leading-[1.05] tracking-[var(--tracking-tight)] text-pearl">
          {t("voice.title")}
        </h1>
        <p className="max-w-[640px] text-[var(--text-lg)] leading-[1.55] text-pearl-muted">
          {t("voice.subtitle")}
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          <GlassPanel className="space-y-4">
            <SpecLabel>{t("voice.waveformLabel")}</SpecLabel>
            <canvas
              ref={canvasRef}
              width={960}
              height={140}
              role="img"
              aria-label={t("voice.waveformLabel")}
              className="h-32 w-full rounded-[var(--radius-md)] bg-[rgba(8,9,12,0.4)]"
            />
            <p
              role="status"
              aria-live="polite"
              className="luxe-mono min-h-[1.5rem] text-[var(--text-caption)] uppercase tracking-[var(--tracking-wider)] text-pearl-soft"
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
          </GlassPanel>

          <div className="space-y-2">
            <label htmlFor="transcript">
              <SpecLabel>{t("voice.transcriptLabel")}</SpecLabel>
            </label>
            <Textarea
              id="transcript"
              value={partial || draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={5}
              placeholder={t("voice.transcriptPlaceholder")}
            />
          </div>

          {error ? (
            <Alert tone="danger" title={t("voice.state.error")}>
              {error}
            </Alert>
          ) : null}

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

        <GlassPanel variant="muted" as="aside" className="space-y-3">
          <SpecLabel>{t("voice.tipsTitle")}</SpecLabel>
          <ul className="space-y-2 text-[var(--text-control)] leading-[1.6] text-pearl-muted">
            <li>{t("voice.tips.environment")}</li>
            <li>{t("voice.tips.bargein")}</li>
            <li>{t("voice.tips.edit")}</li>
          </ul>
        </GlassPanel>
      </div>
    </section>
  );
}
