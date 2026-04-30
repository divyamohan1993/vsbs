"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  captureFromFile,
  captureFromVideo,
  getCameraStream,
  redactPhoto,
  stopStream,
  uploadPhoto,
  type CapturedPhoto,
  type PhotoUploadResponse,
} from "../../../lib/photo";
import { Button } from "../../../components/ui/Button";
import { Alert, Badge, Input, Label, Select } from "../../../components/ui/Form";
import { LoadingState } from "../../../components/states";
import { GlassPanel, SpecLabel } from "../../../components/luxe";

type Kind = "dashcam" | "instrument-cluster" | "exterior" | "underbody";

export function PhotoIntakeClient(): React.JSX.Element {
  const t = useTranslations();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<CapturedPhoto | null>(null);
  const [intakeId, setIntakeId] = useState<string>(() => `intake-${Date.now()}`);
  const [kind, setKind] = useState<Kind>("dashcam");
  const [busy, setBusy] = useState(false);
  const [redacting, setRedacting] = useState(false);
  const [finding, setFinding] = useState<PhotoUploadResponse["finding"] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => stopStream(stream);
  }, [stream]);

  const enableCamera = async (): Promise<void> => {
    setStreamError(null);
    try {
      const s = await getCameraStream();
      setStream(s);
      const v = videoRef.current;
      if (v) {
        v.srcObject = s;
        await v.play().catch(() => {
          /* play may fail without user gesture */
        });
      }
    } catch (err) {
      setStreamError(err instanceof Error ? err.message : String(err));
    }
  };

  const ingest = async (raw: CapturedPhoto): Promise<void> => {
    setRedacting(true);
    setError(null);
    try {
      const redacted = await redactPhoto(raw);
      setPhoto(redacted);
      setFinding(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRedacting(false);
    }
  };

  const capture = async (): Promise<void> => {
    const v = videoRef.current;
    if (!v) return;
    try {
      const p = await captureFromVideo(v);
      await ingest(p);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const p = await captureFromFile(file);
      await ingest(p);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const submit = async (): Promise<void> => {
    if (!photo) return;
    if (!photo.redactionSummary?.ok) {
      setError(t("photo.state.redactionRequired"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await uploadPhoto(photo, intakeId, kind);
      setFinding(res.finding);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mx-auto w-full max-w-[1180px] space-y-10 px-6 py-[56px] md:py-[120px]">
      <header className="space-y-3">
        <SpecLabel>{t("photo.eyebrow")}</SpecLabel>
        <h1 className="font-[family-name:var(--font-display)] text-[var(--text-h1)] font-medium leading-[1.05] tracking-[var(--tracking-tight)] text-pearl">
          {t("photo.title")}
        </h1>
        <p className="max-w-[640px] text-[var(--text-lg)] leading-[1.55] text-pearl-muted">
          {t("photo.subtitle")}
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          <GlassPanel className="space-y-4">
            <video
              ref={videoRef}
              playsInline
              muted
              aria-label={t("photo.cameraAlt")}
              className="aspect-video w-full rounded-[var(--radius-md)] bg-black"
            />
            <div className="flex flex-wrap items-center gap-3">
              {!stream ? (
                <Button onClick={() => void enableCamera()}>{t("photo.button.enable")}</Button>
              ) : (
                <Button onClick={() => void capture()}>{t("photo.button.capture")}</Button>
              )}
              <Label className="inline-flex items-center gap-2">
                <span>{t("photo.button.upload")}</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={onFile}
                  className="block w-full text-[var(--text-caption)] text-pearl-muted file:mr-3 file:rounded-[var(--radius-sm)] file:border file:border-[var(--color-hairline-strong)] file:bg-transparent file:px-3 file:py-2 file:text-pearl"
                />
              </Label>
            </div>
            {streamError ? (
              <Alert tone="warning" title={t("photo.state.cameraError")}>
                {streamError}
              </Alert>
            ) : null}
          </GlassPanel>

          {redacting ? (
            <LoadingState
              heading={t("photo.state.redacting")}
              body={t("photo.state.redactingBody")}
            />
          ) : null}

          {photo ? (
            <GlassPanel className="space-y-4">
              <div className="flex items-center justify-between">
                <SpecLabel>{t("photo.preview")}</SpecLabel>
                <Badge tone="info">
                  {(photo.bytes / 1024).toFixed(0)} KB · {photo.width}×{photo.height}
                </Badge>
              </div>
              {photo.redactionSummary ? (
                <p
                  className="text-[var(--text-caption)] text-pearl-soft"
                  aria-live="polite"
                >
                  {t("photo.redaction.summary", {
                    faces: photo.redactionSummary.faces,
                    plates: photo.redactionSummary.plates,
                    ms: photo.redactionSummary.durationMs,
                  })}
                </p>
              ) : null}
              <img
                src={URL.createObjectURL(photo.blob)}
                alt={t("photo.previewAlt")}
                className="max-h-96 w-full rounded-[var(--radius-md)] object-contain"
                onLoad={(e) => URL.revokeObjectURL((e.target as HTMLImageElement).src)}
              />
              <div className="flex flex-wrap gap-3">
                <Button
                  onClick={() => void submit()}
                  loading={busy}
                  loadingText={t("photo.button.uploading")}
                >
                  {t("photo.button.submit")}
                </Button>
                <Button variant="ghost" onClick={() => setPhoto(null)}>
                  {t("photo.button.retake")}
                </Button>
              </div>
              {error ? (
                <Alert tone="danger" title={t("photo.state.uploadError")}>
                  {error}
                </Alert>
              ) : null}
            </GlassPanel>
          ) : null}

          {busy && !finding ? (
            <LoadingState
              heading={t("photo.state.analysing")}
              body={t("photo.state.analysingBody")}
            />
          ) : null}

          {finding ? (
            <GlassPanel
              variant="elevated"
              as="article"
              aria-live="polite"
              className="border border-[var(--color-emerald)]"
            >
              <header className="flex items-center justify-between">
                <SpecLabel>{t("photo.finding.title")}</SpecLabel>
                <Badge tone="success">{(finding.confidence * 100).toFixed(0)}%</Badge>
              </header>
              <p className="mt-3 font-[family-name:var(--font-display)] text-[var(--text-h4)] tracking-[var(--tracking-tight)] text-pearl">
                {finding.label}
              </p>
              <p className="mt-2 text-[var(--text-control)] leading-[1.6] text-pearl-muted">
                {finding.rationale}
              </p>
              <ul className="mt-3 list-disc pl-5 text-[var(--text-control)] text-pearl-muted">
                {finding.suggestedActions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </GlassPanel>
          ) : null}
        </div>

        <GlassPanel variant="muted" as="aside" className="space-y-4">
          <SpecLabel>{t("photo.options.title")}</SpecLabel>
          <div className="space-y-2">
            <Label htmlFor="intakeId">{t("photo.options.intakeId")}</Label>
            <Input
              id="intakeId"
              value={intakeId}
              onChange={(e) => setIntakeId(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="kind">{t("photo.options.kind")}</Label>
            <Select
              id="kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as Kind)}
            >
              <option value="dashcam">{t("photo.kinds.dashcam")}</option>
              <option value="instrument-cluster">{t("photo.kinds.instrument")}</option>
              <option value="exterior">{t("photo.kinds.exterior")}</option>
              <option value="underbody">{t("photo.kinds.underbody")}</option>
            </Select>
          </div>
          <p className="text-[var(--text-caption)] leading-[1.6] text-pearl-soft">
            {t("photo.options.privacy")}
          </p>
        </GlassPanel>
      </div>
    </section>
  );
}
