"use client";

// 4-step booking intake. Uses React 19 transitions + useOptimistic to keep
// each step progress visible without blank spinners. Every fetch hits the
// Next proxy route so the browser only ever talks to its own origin.

import { useOptimistic, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { z } from "zod";

type Severity = "red" | "amber" | "green";

interface StepProgress {
  step: 1 | 2 | 3 | 4;
  label: string;
  busy: boolean;
}

interface VinDecoded {
  make?: string | undefined;
  model?: string | undefined;
  year?: number | undefined;
}

const E164 = z
  .string()
  .regex(/^\+[1-9]\d{6,14}$/, { message: "Use +<country><number>" });

const VinRe = z.string().length(17, { message: "VIN must be 17 characters" });

const RED_FLAGS = [
  "brake-failure",
  "steering-failure",
  "engine-fire",
  "visible-smoke-from-hood",
  "fluid-puddle-large",
  "coolant-boiling",
  "oil-pressure-red-light",
  "airbag-deployed-recent",
  "ev-battery-thermal-warning",
  "driver-reports-unsafe",
] as const;

type RedFlag = (typeof RED_FLAGS)[number];

type CanDrive =
  | "yes-confidently"
  | "yes-cautiously"
  | "unsure"
  | "no"
  | "already-stranded";

interface FormState {
  phone: string;
  challengeId: string | null;
  demoCode: string | null;
  otp: string;
  subject: string | null;
  vin: string;
  vehicle: VinDecoded | null;
  manualMake: string;
  manualModel: string;
  manualYear: string;
  symptoms: string;
  canDriveSafely: CanDrive | "";
  redFlags: RedFlag[];
  severity: Severity | null;
  rationale: string;
  triggered: string[];
}

const initial: FormState = {
  phone: "",
  challengeId: null,
  demoCode: null,
  otp: "",
  subject: null,
  vin: "",
  vehicle: null,
  manualMake: "",
  manualModel: "",
  manualYear: "",
  symptoms: "",
  canDriveSafely: "",
  redFlags: [],
  severity: null,
  rationale: "",
  triggered: [],
};

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/proxy/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as { data?: T; error?: { message?: string } };
  if (!res.ok || !data.data) {
    throw new Error(data.error?.message ?? `Request failed (${res.status})`);
  }
  return data.data;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`/api/proxy/${path}`, { method: "GET" });
  const data = (await res.json()) as { data?: T; error?: { message?: string } };
  if (!res.ok || !data.data) {
    throw new Error(data.error?.message ?? `Request failed (${res.status})`);
  }
  return data.data;
}

export function BookingWizard(): React.JSX.Element {
  const t = useTranslations();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [form, setForm] = useState<FormState>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [progress, setProgress] = useOptimistic<StepProgress, StepProgress>(
    { step, label: t("book.progress.idle"), busy: false },
    (_prev, next) => next,
  );

  function patch(p: Partial<FormState>): void {
    setForm((s) => ({ ...s, ...p }));
  }

  function runStep(label: string, fn: () => Promise<void>): void {
    setError(null);
    startTransition(async () => {
      setProgress({ step, label, busy: true });
      try {
        await fn();
        setProgress({ step, label: t("book.progress.done"), busy: false });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setProgress({ step, label: t("book.progress.failed"), busy: false });
      }
    });
  }

  // ---- step 1: OTP
  function onOtpStart(): void {
    const parsed = E164.safeParse(form.phone);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid phone");
      return;
    }
    runStep(t("book.progress.sendingOtp"), async () => {
      const data = await postJson<{
        challengeId: string;
        demoCode?: string;
        deliveryHint: string;
      }>("auth/otp/start", { phone: form.phone, purpose: "login", locale: "en" });
      patch({
        challengeId: data.challengeId,
        demoCode: data.demoCode ?? null,
      });
    });
  }

  function onOtpVerify(): void {
    if (!form.challengeId || form.otp.length < 4) {
      setError(t("book.errors.otpRequired"));
      return;
    }
    runStep(t("book.progress.verifyingOtp"), async () => {
      const data = await postJson<{ ok: true; subject: string }>("auth/otp/verify", {
        challengeId: form.challengeId,
        code: form.otp,
      });
      patch({ subject: data.subject });
      setStep(2);
    });
  }

  // ---- step 2: VIN
  function onDecodeVin(): void {
    const parsed = VinRe.safeParse(form.vin.toUpperCase());
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid VIN");
      return;
    }
    runStep(t("book.progress.decodingVin"), async () => {
      const data = await getJson<{
        make?: string;
        model?: string;
        year?: number;
      }>(`vin/${parsed.data}`);
      patch({ vehicle: { make: data.make, model: data.model, year: data.year } });
    });
  }

  function onManualVehicle(): void {
    const year = Number.parseInt(form.manualYear, 10);
    if (!form.manualMake || !form.manualModel || Number.isNaN(year)) {
      setError(t("book.errors.manualVehicleRequired"));
      return;
    }
    patch({ vehicle: { make: form.manualMake, model: form.manualModel, year } });
    setError(null);
    setStep(3);
  }

  function onVehicleNext(): void {
    if (!form.vehicle) {
      setError(t("book.errors.vehicleRequired"));
      return;
    }
    setStep(3);
  }

  // ---- step 3: symptoms
  function toggleFlag(f: RedFlag): void {
    patch({
      redFlags: form.redFlags.includes(f)
        ? form.redFlags.filter((x) => x !== f)
        : [...form.redFlags, f],
    });
  }

  function onAssess(): void {
    if (!form.canDriveSafely) {
      setError(t("book.errors.canDriveRequired"));
      return;
    }
    if (form.symptoms.trim().length < 3) {
      setError(t("book.errors.symptomsRequired"));
      return;
    }
    runStep(t("book.progress.assessingSafety"), async () => {
      const data = await postJson<{
        severity: Severity;
        triggered: string[];
        rationale: string;
      }>("safety/assess", {
        owner: {
          canDriveSafely: form.canDriveSafely,
          redFlags: form.redFlags,
        },
        sensorFlags: [],
      });
      patch({
        severity: data.severity,
        triggered: data.triggered,
        rationale: data.rationale,
      });
      setStep(4);
    });
  }

  // ---- step 4: confirm
  function onConfirm(): void {
    runStep(t("book.progress.confirming"), async () => {
      // Commit is handled elsewhere in the agent pipeline; here we just
      // acknowledge the review screen so the user gets a deterministic
      // completion event.
      await new Promise((r) => setTimeout(r, 150));
    });
  }

  const severityClass: Record<Severity, string> = {
    green: "border-success text-success",
    amber: "border-[oklch(82%_0.16_85)] text-[oklch(90%_0.16_85)]",
    red: "border-danger text-danger",
  };

  return (
    <div className="space-y-6">
      <Stepper step={step} t={t} />

      <output
        aria-live="polite"
        className="block text-sm text-muted"
      >
        {t("book.progress.label")}: {progress.label}
      </output>

      {error ? (
        <div
          role="alert"
          className="rounded-[var(--radius-card)] border-2 border-danger px-4 py-3 text-on-surface"
        >
          {error}
        </div>
      ) : null}

      {step === 1 ? (
        <fieldset className="space-y-4 rounded-[var(--radius-card)] border border-muted/30 p-6">
          <legend className="font-display text-2xl font-semibold">{t("book.step1.title")}</legend>

          <label className="block space-y-2">
            <span className="block text-sm font-medium">{t("book.step1.phoneLabel")}</span>
            <input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={form.phone}
              onChange={(e) => patch({ phone: e.target.value })}
              placeholder="+919876543210"
              className="block w-full rounded-[var(--radius-card)] border border-muted/40 bg-transparent px-4 py-3 text-on-surface"
              disabled={form.challengeId !== null}
            />
          </label>

          {form.challengeId === null ? (
            <button
              type="button"
              onClick={onOtpStart}
              disabled={pending}
              className="inline-flex items-center justify-center rounded-[var(--radius-card)] bg-accent px-6 py-3 font-semibold text-accent-on"
            >
              {t("book.step1.sendOtp")}
            </button>
          ) : (
            <div className="space-y-3">
              {form.demoCode ? (
                <p
                  role="note"
                  className="rounded-[var(--radius-card)] border-2 border-accent px-4 py-2 text-sm text-on-surface"
                >
                  {t("book.step1.demoCode")}: <strong>{form.demoCode}</strong>
                </p>
              ) : null}
              <label className="block space-y-2">
                <span className="block text-sm font-medium">{t("book.step1.otpLabel")}</span>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={form.otp}
                  onChange={(e) => patch({ otp: e.target.value })}
                  className="block w-full rounded-[var(--radius-card)] border border-muted/40 bg-transparent px-4 py-3 text-on-surface"
                />
              </label>
              <button
                type="button"
                onClick={onOtpVerify}
                disabled={pending}
                className="inline-flex items-center justify-center rounded-[var(--radius-card)] bg-accent px-6 py-3 font-semibold text-accent-on"
              >
                {t("book.step1.verify")}
              </button>
            </div>
          )}
        </fieldset>
      ) : null}

      {step === 2 ? (
        <fieldset className="space-y-4 rounded-[var(--radius-card)] border border-muted/30 p-6">
          <legend className="font-display text-2xl font-semibold">{t("book.step2.title")}</legend>

          <label className="block space-y-2">
            <span className="block text-sm font-medium">{t("book.step2.vinLabel")}</span>
            <input
              type="text"
              value={form.vin}
              onChange={(e) => patch({ vin: e.target.value.toUpperCase() })}
              maxLength={17}
              className="block w-full rounded-[var(--radius-card)] border border-muted/40 bg-transparent px-4 py-3 font-mono text-on-surface"
            />
          </label>
          <button
            type="button"
            onClick={onDecodeVin}
            disabled={pending}
            className="inline-flex items-center justify-center rounded-[var(--radius-card)] bg-accent px-6 py-3 font-semibold text-accent-on"
          >
            {t("book.step2.decode")}
          </button>

          {form.vehicle ? (
            <dl className="grid grid-cols-3 gap-3 rounded-[var(--radius-card)] border border-muted/30 p-4">
              <div>
                <dt className="text-xs text-muted">{t("book.step2.make")}</dt>
                <dd className="font-medium">{form.vehicle.make ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">{t("book.step2.model")}</dt>
                <dd className="font-medium">{form.vehicle.model ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">{t("book.step2.year")}</dt>
                <dd className="font-medium">{form.vehicle.year ?? "—"}</dd>
              </div>
            </dl>
          ) : null}

          <details className="rounded-[var(--radius-card)] border border-muted/30 p-4">
            <summary className="cursor-pointer font-medium">{t("book.step2.manual")}</summary>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <label className="space-y-1">
                <span className="block text-sm">{t("book.step2.make")}</span>
                <input
                  type="text"
                  value={form.manualMake}
                  onChange={(e) => patch({ manualMake: e.target.value })}
                  className="w-full rounded-[var(--radius-card)] border border-muted/40 bg-transparent px-3 py-2"
                />
              </label>
              <label className="space-y-1">
                <span className="block text-sm">{t("book.step2.model")}</span>
                <input
                  type="text"
                  value={form.manualModel}
                  onChange={(e) => patch({ manualModel: e.target.value })}
                  className="w-full rounded-[var(--radius-card)] border border-muted/40 bg-transparent px-3 py-2"
                />
              </label>
              <label className="space-y-1">
                <span className="block text-sm">{t("book.step2.year")}</span>
                <input
                  type="number"
                  value={form.manualYear}
                  onChange={(e) => patch({ manualYear: e.target.value })}
                  className="w-full rounded-[var(--radius-card)] border border-muted/40 bg-transparent px-3 py-2"
                />
              </label>
            </div>
            <button
              type="button"
              onClick={onManualVehicle}
              className="mt-3 inline-flex items-center justify-center rounded-[var(--radius-card)] border border-muted/40 px-4 py-2"
            >
              {t("book.step2.useManual")}
            </button>
          </details>

          <button
            type="button"
            onClick={onVehicleNext}
            className="inline-flex items-center justify-center rounded-[var(--radius-card)] bg-accent px-6 py-3 font-semibold text-accent-on"
          >
            {t("book.next")}
          </button>
        </fieldset>
      ) : null}

      {step === 3 ? (
        <fieldset className="space-y-4 rounded-[var(--radius-card)] border border-muted/30 p-6">
          <legend className="font-display text-2xl font-semibold">{t("book.step3.title")}</legend>

          <label className="block space-y-2">
            <span className="block text-sm font-medium">{t("book.step3.symptomsLabel")}</span>
            <textarea
              value={form.symptoms}
              onChange={(e) => patch({ symptoms: e.target.value })}
              rows={4}
              className="block w-full rounded-[var(--radius-card)] border border-muted/40 bg-transparent px-4 py-3 text-on-surface"
            />
          </label>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t("book.step3.canDriveLabel")}</legend>
            {(
              [
                "yes-confidently",
                "yes-cautiously",
                "unsure",
                "no",
                "already-stranded",
              ] as const
            ).map((v) => (
              <label key={v} className="flex items-center gap-3">
                <input
                  type="radio"
                  name="canDrive"
                  value={v}
                  checked={form.canDriveSafely === v}
                  onChange={() => patch({ canDriveSafely: v })}
                />
                <span>{t(`book.step3.canDrive.${v}`)}</span>
              </label>
            ))}
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t("book.step3.redFlagsLabel")}</legend>
            <ul className="grid gap-2 md:grid-cols-2">
              {RED_FLAGS.map((f) => (
                <li key={f}>
                  <label className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={form.redFlags.includes(f)}
                      onChange={() => toggleFlag(f)}
                    />
                    <span>{t(`book.redFlags.${f}`)}</span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>

          <button
            type="button"
            onClick={onAssess}
            disabled={pending}
            className="inline-flex items-center justify-center rounded-[var(--radius-card)] bg-accent px-6 py-3 font-semibold text-accent-on"
          >
            {t("book.step3.assess")}
          </button>
        </fieldset>
      ) : null}

      {step === 4 && form.severity ? (
        <section
          aria-labelledby="review-h"
          className="space-y-4 rounded-[var(--radius-card)] border border-muted/30 p-6"
        >
          <h2 id="review-h" className="font-display text-2xl font-semibold">
            {t("book.step4.title")}
          </h2>
          <p
            className={`inline-block rounded-[var(--radius-card)] border-2 px-4 py-2 font-semibold ${severityClass[form.severity]}`}
          >
            {t(`book.severity.${form.severity}`)}
          </p>
          <p className="text-on-surface">{form.rationale}</p>
          {form.triggered.length > 0 ? (
            <ul className="list-disc space-y-1 pl-6 text-sm">
              {form.triggered.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          ) : null}
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className="inline-flex items-center justify-center rounded-[var(--radius-card)] bg-accent px-6 py-3 font-semibold text-accent-on"
          >
            {t("book.step4.confirm")}
          </button>
        </section>
      ) : null}
    </div>
  );
}

function Stepper({
  step,
  t,
}: {
  step: 1 | 2 | 3 | 4;
  t: ReturnType<typeof useTranslations>;
}): React.JSX.Element {
  const labels: Array<{ n: 1 | 2 | 3 | 4; k: string }> = [
    { n: 1, k: "book.stepper.1" },
    { n: 2, k: "book.stepper.2" },
    { n: 3, k: "book.stepper.3" },
    { n: 4, k: "book.stepper.4" },
  ];
  return (
    <ol
      className="grid grid-cols-4 gap-2"
      aria-label={t("book.stepper.label")}
    >
      {labels.map(({ n, k }) => {
        const active = n === step;
        const done = n < step;
        return (
          <li
            key={n}
            aria-current={active ? "step" : undefined}
            className={`rounded-[var(--radius-card)] border-2 px-3 py-2 text-xs font-medium ${
              active
                ? "border-accent text-on-surface"
                : done
                  ? "border-success text-on-surface"
                  : "border-muted/30 text-muted"
            }`}
          >
            <span className="block text-[0.65rem] uppercase tracking-wider">
              {t("book.stepper.stepLabel", { n })}
            </span>
            {t(k)}
          </li>
        );
      })}
    </ol>
  );
}
