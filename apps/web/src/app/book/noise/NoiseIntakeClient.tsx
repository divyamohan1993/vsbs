"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { recordClip, uploadClip, type AudioUploadResponse, type CapturedClip } from "../../../lib/audio";
import { Button } from "../../../components/ui/Button";
import { Alert, Badge, Input, Label, Select, Slider } from "../../../components/ui/Form";
import { LoadingState } from "../../../components/states";

type Label = "engine" | "brake" | "drivetrain";

export function NoiseIntakeClient(): React.JSX.Element {
  const t = useTranslations();
  const [label, setLabel] = useState<Label>("brake");
  const [intakeId, setIntakeId] = useState<string>(() => `intake-${Date.now()}`);
  const [durationMs, setDurationMs] = useState<number>(4000);
  const [clip, setClip] = useState<CapturedClip | null>(null);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [level, setLevel] = useState(0);
  const [classification, setClassification] = useState<AudioUploadResponse["classification"] | null>(null);
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
    <section className="space-y-6 py-6">
      <header className="space-y-1">
        <p className="text-muted text-sm uppercase tracking-[0.2em]">{t("noise.eyebrow")}</p>
        <h1 className="font-display text-3xl font-semibold">{t("noise.title")}</h1>
        <p className="text-muted">{t("noise.subtitle")}</p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          <div className="rounded-[var(--radius-card)] border border-muted/30 p-4" style={{ backgroundColor: "oklch(20% 0.02 260)" }}>
            <p className="text-xs uppercase tracking-wide text-muted">{t("noise.levelLabel")}</p>
            <div
              role="meter"
              aria-label={t("noise.levelLabel")}
              aria-valuemin={0}
              aria-valuemax={1}
              aria-valuenow={Math.min(1, level)}
              className="mt-2 h-3 overflow-hidden rounded-full bg-muted/20"
            >
              <div className="h-full bg-accent transition-[width]" style={{ width: `${Math.min(100, level * 200)}%` }} aria-hidden="true" />
            </div>
            <p
              role="status"
              aria-live="polite"
              className="mt-3 text-sm text-muted"
            >
              {recording ? t("noise.state.recording") : clip ? t("noise.state.recorded", { ms: clip.durationMs }) : t("noise.state.idle")}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button onClick={() => void startRec()} loading={recording} loadingText={t("noise.button.recording")}>
                {t("noise.button.record")}
              </Button>
              <Button variant="outline" onClick={() => setClip(null)} disabled={!clip}>
                {t("noise.button.clear")}
              </Button>
            </div>
            {error ? <Alert tone="danger" title={t("noise.state.error")} className="mt-3">{error}</Alert> : null}
          </div>

          {clip ? (
            <div className="rounded-[var(--radius-card)] border border-muted/30 p-4" style={{ backgroundColor: "oklch(20% 0.02 260)" }}>
              <div className="flex items-center justify-between">
                <p className="font-display text-lg font-semibold">{t("noise.clipTitle")}</p>
                <Badge tone="info">{(clip.wav.size / 1024).toFixed(0)} KB · {clip.sampleRate} Hz</Badge>
              </div>
              <audio controls src={URL.createObjectURL(clip.wav)} className="mt-3 w-full" />
              <Button className="mt-3" onClick={() => void submit()} loading={busy} loadingText={t("noise.button.classifying")}>
                {t("noise.button.submit")}
              </Button>
            </div>
          ) : null}

          {busy && !classification ? (
            <LoadingState heading={t("noise.state.classifying")} body={t("noise.state.classifyingBody")} />
          ) : null}

          {classification ? (
            <article className="rounded-[var(--radius-card)] border-2 border-success p-4" style={{ backgroundColor: "oklch(20% 0.02 260)" }} aria-live="polite">
              <header className="flex items-center justify-between">
                <h2 className="font-display text-lg font-semibold">{t("noise.finding.title")}</h2>
                <Badge tone={classification.label === "healthy" ? "success" : "warning"}>
                  {(classification.confidence * 100).toFixed(0)}%
                </Badge>
              </header>
              <p className="mt-2 font-semibold">{classification.label}</p>
              <p className="mt-1 text-sm text-muted">{classification.rationale}</p>
              <ul className="mt-2 list-disc pl-4 text-sm">
                {classification.suggestedActions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </article>
          ) : null}
        </div>

        <aside className="space-y-3 rounded-[var(--radius-card)] border border-muted/30 p-4 text-sm" style={{ backgroundColor: "oklch(20% 0.02 260)" }}>
          <h2 className="font-display text-lg font-semibold">{t("noise.options.title")}</h2>
          <div>
            <Label htmlFor="noise-intakeId">{t("noise.options.intakeId")}</Label>
            <Input id="noise-intakeId" value={intakeId} onChange={(e) => setIntakeId(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="noise-label">{t("noise.options.label")}</Label>
            <Select id="noise-label" value={label} onChange={(e) => setLabel(e.target.value as Label)}>
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
          <p className="text-muted">{t("noise.options.tip")}</p>
        </aside>
      </div>
    </section>
  );
}
