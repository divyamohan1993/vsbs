"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  recordClip,
  uploadClip,
  type AudioUploadResponse,
  type CapturedClip,
} from "../../../lib/audio";
import { Button } from "../../../components/ui/Button";
import { Alert, Badge, Input, Label, Select, Slider } from "../../../components/ui/Form";
import { LoadingState } from "../../../components/states";
import { GlassPanel, SpecLabel } from "../../../components/luxe";

type SoundLabel = "engine" | "brake" | "drivetrain";

export function NoiseIntakeClient(): React.JSX.Element {
  const t = useTranslations();
  const [label, setLabel] = useState<SoundLabel>("brake");
  const [intakeId, setIntakeId] = useState<string>(() => `intake-${Date.now()}`);
  const [durationMs, setDurationMs] = useState<number>(4000);
  const [clip, setClip] = useState<CapturedClip | null>(null);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [level, setLevel] = useState(0);
  const [classification, setClassification] = useState<
    AudioUploadResponse["classification"] | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  const startRec = async (): Promise<void> => {
    setError(null);
    setClassification(null);
    setRecording(true);
    try {
      const c = await recordClip(durationMs, (rms) => setLevel(rms));
      setClip(c);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRecording(false);
      setLevel(0);
    }
  };

  const submit = async (): Promise<void> => {
    if (!clip) return;
    setBusy(true);
    setError(null);
    try {
      const res = await uploadClip(clip, intakeId, label);
      setClassification(res.classification);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mx-auto w-full max-w-[1180px] space-y-10 px-6 py-[56px] md:py-[120px]">
      <header className="space-y-3">
        <SpecLabel>{t("noise.eyebrow")}</SpecLabel>
        <h1 className="font-[family-name:var(--font-display)] text-[length:var(--text-h1)] font-medium leading-[1.05] tracking-[var(--tracking-tight)] text-pearl">
          {t("noise.title")}
        </h1>
        <p className="max-w-[640px] text-[length:var(--text-lg)] leading-[1.55] text-pearl-muted">
          {t("noise.subtitle")}
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          <GlassPanel className="space-y-4">
            <SpecLabel>{t("noise.levelLabel")}</SpecLabel>
            <div
              role="meter"
              aria-label={t("noise.levelLabel")}
              aria-valuemin={0}
              aria-valuemax={1}
              aria-valuenow={Math.min(1, level)}
              className="h-2 overflow-hidden rounded-full bg-[var(--color-hairline)]"
            >
              <div
                className="h-full"
                style={{
                  width: `${Math.min(100, level * 200)}%`,
                  background:
                    "linear-gradient(90deg, var(--color-accent-sky), var(--color-accent-deep))",
                  transition: "width var(--duration-state) var(--ease-enter)",
                }}
                aria-hidden="true"
              />
            </div>
            <p
              role="status"
              aria-live="polite"
              className="luxe-mono text-[length:var(--text-caption)] uppercase tracking-[var(--tracking-wider)] text-pearl-soft"
            >
              {recording
                ? t("noise.state.recording")
                : clip
                  ? t("noise.state.recorded", { ms: clip.durationMs })
                  : t("noise.state.idle")}
            </p>
            <div className="flex flex-wrap gap-3 pt-2">
              <Button
                onClick={() => void startRec()}
                loading={recording}
                loadingText={t("noise.button.recording")}
              >
                {t("noise.button.record")}
              </Button>
              <Button variant="outline" onClick={() => setClip(null)} disabled={!clip}>
                {t("noise.button.clear")}
              </Button>
            </div>
            {error ? (
              <Alert tone="danger" title={t("noise.state.error")}>
                {error}
              </Alert>
            ) : null}
          </GlassPanel>

          {clip ? (
            <GlassPanel className="space-y-4">
              <div className="flex items-center justify-between">
                <SpecLabel>{t("noise.clipTitle")}</SpecLabel>
                <Badge tone="info">
                  {(clip.wav.size / 1024).toFixed(0)} KB · {clip.sampleRate} Hz
                </Badge>
              </div>
              <audio controls src={URL.createObjectURL(clip.wav)} className="w-full" />
              <Button
                onClick={() => void submit()}
                loading={busy}
                loadingText={t("noise.button.classifying")}
              >
                {t("noise.button.submit")}
              </Button>
            </GlassPanel>
          ) : null}

          {busy && !classification ? (
            <LoadingState
              heading={t("noise.state.classifying")}
              body={t("noise.state.classifyingBody")}
            />
          ) : null}

          {classification ? (
            <GlassPanel
              variant="elevated"
              as="article"
              aria-live="polite"
              className="border border-[var(--color-emerald)]"
            >
              <header className="flex items-center justify-between">
                <SpecLabel>{t("noise.finding.title")}</SpecLabel>
                <Badge tone={classification.label === "healthy" ? "success" : "warning"}>
                  {(classification.confidence * 100).toFixed(0)}%
                </Badge>
              </header>
              <p className="mt-3 font-[family-name:var(--font-display)] text-[length:var(--text-h4)] tracking-[var(--tracking-tight)] text-pearl">
                {classification.label}
              </p>
              <p className="mt-2 text-[length:var(--text-control)] leading-[1.6] text-pearl-muted">
                {classification.rationale}
              </p>
              <ul className="mt-3 list-disc pl-5 text-[length:var(--text-control)] text-pearl-muted">
                {classification.suggestedActions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </GlassPanel>
          ) : null}
        </div>

        <GlassPanel variant="muted" as="aside" className="space-y-4">
          <SpecLabel>{t("noise.options.title")}</SpecLabel>
          <div className="space-y-2">
            <Label htmlFor="noise-intakeId">{t("noise.options.intakeId")}</Label>
            <Input
              id="noise-intakeId"
              value={intakeId}
              onChange={(e) => setIntakeId(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="noise-label">{t("noise.options.label")}</Label>
            <Select
              id="noise-label"
              value={label}
              onChange={(e) => setLabel(e.target.value as SoundLabel)}
            >
              <option value="brake">{t("noise.labels.brake")}</option>
              <option value="engine">{t("noise.labels.engine")}</option>
              <option value="drivetrain">{t("noise.labels.drivetrain")}</option>
            </Select>
          </div>
          <Slider
            label={t("noise.options.duration")}
            value={durationMs}
            onValueChange={setDurationMs}
            min={1000}
            max={8000}
            step={500}
            formatValue={(v) => `${(v / 1000).toFixed(1)} s`}
          />
          <p className="text-[length:var(--text-caption)] leading-[1.6] text-pearl-soft">
            {t("noise.options.tip")}
          </p>
        </GlassPanel>
      </div>
    </section>
  );
}
