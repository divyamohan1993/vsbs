"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  captureFromFile,
  captureFromVideo,
  getCameraStream,
  stopStream,
  uploadPhoto,
  type CapturedPhoto,
  type PhotoUploadResponse,
} from "../../../lib/photo";
import { Button } from "../../../components/ui/Button";
import { Alert, Badge, Input, Label, Select } from "../../../components/ui/Form";
import { LoadingState } from "../../../components/states";

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
        await v.play().catch(() => {/* play may fail without user gesture */});
      }
    } catch (err) {
      setStreamError(err instanceof Error ? err.message : String(err));
    }
  };

  const capture = async (): Promise<void> => {
    const v = videoRef.current;
    if (!v) return;
    try {
      const p = await captureFromVideo(v);
      setPhoto(p);
      setFinding(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const p = await captureFromFile(file);
      setPhoto(p);
      setFinding(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const submit = async (): Promise<void> => {
    if (!photo) return;
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
    <section className="space-y-6 py-6">
      <header className="space-y-1">
        <p className="text-muted text-sm uppercase tracking-[0.2em]">{t("photo.eyebrow")}</p>
        <h1 className="font-display text-3xl font-semibold">{t("photo.title")}</h1>
        <p className="text-muted">{t("photo.subtitle")}</p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          <div className="rounded-[var(--radius-card)] border border-muted/30 p-4" style={{ backgroundColor: "oklch(20% 0.02 260)" }}>
            <video
              ref={videoRef}
              playsInline
              muted
              aria-label={t("photo.cameraAlt")}
              className="aspect-video w-full rounded-[var(--radius-card)] bg-black"
            />
            <div className="mt-3 flex flex-wrap gap-2">
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
                  className="block w-full text-sm"
                />
              </Label>
            </div>
            {streamError ? <Alert tone="warning" title={t("photo.state.cameraError")}>{streamError}</Alert> : null}
          </div>

          {photo ? (
            <div className="rounded-[var(--radius-card)] border border-muted/30 p-4" style={{ backgroundColor: "oklch(20% 0.02 260)" }}>
              <div className="flex items-center justify-between">
                <p className="font-display text-lg font-semibold">{t("photo.preview")}</p>
                <Badge tone="info">{(photo.bytes / 1024).toFixed(0)} KB · {photo.width}×{photo.height}</Badge>
              </div>
              <img
                src={URL.createObjectURL(photo.blob)}
                alt={t("photo.previewAlt")}
                className="mt-3 max-h-96 w-full rounded-[var(--radius-card)] object-contain"
                onLoad={(e) => URL.revokeObjectURL((e.target as HTMLImageElement).src)}
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <Button onClick={() => void submit()} loading={busy} loadingText={t("photo.button.uploading")}>
                  {t("photo.button.submit")}
                </Button>
                <Button variant="ghost" onClick={() => setPhoto(null)}>
                  {t("photo.button.retake")}
                </Button>
              </div>
              {error ? <Alert tone="danger" title={t("photo.state.uploadError")} className="mt-3">{error}</Alert> : null}
            </div>
          ) : null}

          {busy && !finding ? (
            <LoadingState heading={t("photo.state.analysing")} body={t("photo.state.analysingBody")} />
          ) : null}

          {finding ? (
            <article
              className="rounded-[var(--radius-card)] border-2 border-success p-4"
              style={{ backgroundColor: "oklch(20% 0.02 260)" }}
              aria-live="polite"
            >
              <header className="flex items-center justify-between">
                <h2 className="font-display text-lg font-semibold">{t("photo.finding.title")}</h2>
                <Badge tone="success">{(finding.confidence * 100).toFixed(0)}%</Badge>
              </header>
              <p className="mt-2 font-semibold">{finding.label}</p>
              <p className="mt-1 text-sm text-muted">{finding.rationale}</p>
              <ul className="mt-2 list-disc pl-4 text-sm">
                {finding.suggestedActions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </article>
          ) : null}
        </div>

        <aside className="space-y-3 rounded-[var(--radius-card)] border border-muted/30 p-4 text-sm" style={{ backgroundColor: "oklch(20% 0.02 260)" }}>
          <h2 className="font-display text-lg font-semibold">{t("photo.options.title")}</h2>
          <div>
            <Label htmlFor="intakeId">{t("photo.options.intakeId")}</Label>
            <Input id="intakeId" value={intakeId} onChange={(e) => setIntakeId(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="kind">{t("photo.options.kind")}</Label>
            <Select id="kind" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
              <option value="dashcam">{t("photo.kinds.dashcam")}</option>
              <option value="instrument-cluster">{t("photo.kinds.instrument")}</option>
              <option value="exterior">{t("photo.kinds.exterior")}</option>
              <option value="underbody">{t("photo.kinds.underbody")}</option>
            </Select>
          </div>
          <p className="text-muted">{t("photo.options.privacy")}</p>
        </aside>
      </div>
    </section>
  );
}
