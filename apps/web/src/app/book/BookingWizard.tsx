"use client";

// 4 + 1 step booking flow, restyled as a Maybach concierge journey.
// One question per screen. Calm display serif headlines, hairline progress,
// luxe glass panels for inputs and review. The fifth step mounts the live
// concierge stream as the magic moment.

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useTranslations } from "next-intl";
import { z } from "zod";
import { ConciergeRunner } from "./ConciergeRunner";
import {
  AmbientGlow,
  GlassPanel,
  GoldSeal,
  KPIBlock,
  SpecLabel,
} from "../../components/luxe";
import { Button } from "../../components/ui/Button";
import { Input, Textarea } from "../../components/ui/Form";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "../../components/ui/Dialog";
import { useReducedMotion } from "../../lib/motion";

type Severity = "red" | "amber" | "green";
type Step = 1 | 2 | 3 | 4 | 5;

interface VinDecoded {
  make?: string | undefined;
  model?: string | undefined;
  year?: number | undefined;
  trim?: string | undefined;
}

interface BookingCommit {
  id: string;
  status: "accepted";
  createdAt: string;
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
  countryDial: string;
  phoneLocal: string;
  challengeId: string | null;
  demoCode: string | null;
  otp: string[];
  subject: string | null;
  vin: string;
  plate: string;
  odometerKm: string;
  vehicle: VinDecoded | null;
  symptoms: string;
  redFlags: RedFlag[];
  canDriveSafely: CanDrive | "";
  severity: Severity | null;
  rationale: string;
  triggered: string[];
}

const initial: FormState = {
  countryDial: "+91",
  phoneLocal: "",
  challengeId: null,
  demoCode: null,
  otp: ["", "", "", "", "", ""],
  subject: null,
  vin: "",
  plate: "",
  odometerKm: "",
  vehicle: null,
  symptoms: "",
  redFlags: [],
  canDriveSafely: "",
  severity: null,
  rationale: "",
  triggered: [],
};

interface DialCode {
  dial: string;
  iso: string;
  name: string;
}

const DIAL_CODES: ReadonlyArray<DialCode> = [
  { dial: "+91", iso: "IN", name: "India" },
  { dial: "+1", iso: "US", name: "United States" },
  { dial: "+44", iso: "GB", name: "United Kingdom" },
  { dial: "+49", iso: "DE", name: "Germany" },
  { dial: "+33", iso: "FR", name: "France" },
  { dial: "+39", iso: "IT", name: "Italy" },
  { dial: "+34", iso: "ES", name: "Spain" },
  { dial: "+31", iso: "NL", name: "Netherlands" },
  { dial: "+41", iso: "CH", name: "Switzerland" },
  { dial: "+46", iso: "SE", name: "Sweden" },
  { dial: "+47", iso: "NO", name: "Norway" },
  { dial: "+971", iso: "AE", name: "United Arab Emirates" },
  { dial: "+65", iso: "SG", name: "Singapore" },
  { dial: "+81", iso: "JP", name: "Japan" },
  { dial: "+86", iso: "CN", name: "China" },
  { dial: "+82", iso: "KR", name: "South Korea" },
  { dial: "+61", iso: "AU", name: "Australia" },
  { dial: "+64", iso: "NZ", name: "New Zealand" },
] as const;

const INTEGRATIONS = [
  { id: "mercedes-me", name: "Mercedes me", available: true },
  { id: "bmw-connecteddrive", name: "BMW ConnectedDrive", available: false },
  { id: "tesla-app", name: "Tesla App", available: false },
  { id: "smartcar", name: "Smartcar", available: false },
] as const;

const SUGGESTION_CHIPS = [
  "Brake noise",
  "Coolant warning",
  "Tyre pressure",
  "Software update",
  "12V battery",
  "ADAS calibration",
] as const;

const CANONICAL_NO_SAFETY_CERT =
  "I cannot certify safety; please consult a qualified mechanic.";

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
  const reduced = useReducedMotion();
  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState<FormState>(initial);
  const [booking, setBooking] = useState<BookingCommit | null>(null);
  const [conversationId] = useState<string>(() => `conv-${Date.now().toString(36)}`);
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [dialOpen, setDialOpen] = useState(false);
  const [integrationsOpen, setIntegrationsOpen] = useState(false);

  function patch(p: Partial<FormState>): void {
    setForm((s) => ({ ...s, ...p }));
  }

  function clearError(key: string): void {
    setErrors((e) => {
      if (!(key in e)) return e;
      const { [key]: _drop, ...rest } = e;
      void _drop;
      return rest;
    });
  }

  function fail(key: string, message: string): void {
    setErrors((e) => ({ ...e, [key]: message }));
  }

  function run(fn: () => Promise<void>): void {
    setGlobalError(null);
    startTransition(async () => {
      try {
        await fn();
      } catch (err) {
        setGlobalError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  // ---- Step 1: Sign in ----
  function fullPhone(): string {
    return `${form.countryDial}${form.phoneLocal.replace(/\D/g, "")}`;
  }

  function onSendCode(): void {
    const phone = fullPhone();
    const parsed = E164.safeParse(phone);
    if (!parsed.success) {
      fail("phone", parsed.error.issues[0]?.message ?? t("book.errors.otpRequired"));
      return;
    }
    clearError("phone");
    run(async () => {
      const data = await postJson<{
        challengeId: string;
        demoCode?: string;
        deliveryHint: string;
      }>("auth/otp/start", { phone, purpose: "login", locale: "en" });
      patch({ challengeId: data.challengeId, demoCode: data.demoCode ?? null });
    });
  }

  function onOtpVerify(): void {
    const code = form.otp.join("");
    if (!form.challengeId || code.length < 4) {
      fail("otp", t("book.errors.otpRequired"));
      return;
    }
    clearError("otp");
    run(async () => {
      const data = await postJson<{ ok: true; subject: string }>("auth/otp/verify", {
        challengeId: form.challengeId,
        code,
      });
      patch({ subject: data.subject });
      setStep(2);
    });
  }

  function onResend(): void {
    patch({ challengeId: null, demoCode: null, otp: ["", "", "", "", "", ""] });
    onSendCode();
  }

  // ---- Step 2: Vehicle ----
  function onVinChange(value: string): void {
    const upper = value.toUpperCase().slice(0, 17);
    patch({ vin: upper });
    if (upper.length === 17) {
      const parsed = VinRe.safeParse(upper);
      if (parsed.success) {
        clearError("vin");
        run(async () => {
          const data = await getJson<{
            make?: string;
            model?: string;
            year?: number;
            trim?: string;
          }>(`vin/${parsed.data}`);
          patch({
            vehicle: {
              make: data.make,
              model: data.model,
              year: data.year,
              trim: data.trim,
            },
          });
        });
      }
    } else {
      patch({ vehicle: null });
    }
  }

  function onVehicleNext(): void {
    if (!form.vehicle && form.vin.length !== 17) {
      fail("vin", t("book.errors.vehicleRequired"));
      return;
    }
    if (form.vin.length === 17 && !form.vehicle) {
      fail("vin", t("book.errors.decodeFailed"));
      return;
    }
    clearError("vin");
    setStep(3);
  }

  // ---- Step 3: Symptoms ----
  function appendChip(chip: string): void {
    const sep = form.symptoms.trim().length > 0 ? ". " : "";
    patch({ symptoms: `${chip}${sep}${form.symptoms}`.slice(0, 1000) });
  }

  function toggleFlag(f: RedFlag): void {
    patch({
      redFlags: form.redFlags.includes(f)
        ? form.redFlags.filter((x) => x !== f)
        : [...form.redFlags, f],
    });
  }

  function onAssess(): void {
    if (form.symptoms.trim().length < 3) {
      fail("symptoms", t("book.errors.symptomsRequired"));
      return;
    }
    if (!form.canDriveSafely) {
      fail("canDrive", t("book.errors.canDriveRequired"));
      return;
    }
    clearError("symptoms");
    clearError("canDrive");
    run(async () => {
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

  // ---- Step 4: Review ----
  function onConfirm(): void {
    if (!form.severity || !form.canDriveSafely) {
      setGlobalError(t("book.errors.symptomsRequired"));
      return;
    }
    run(async () => {
      const data = await postJson<BookingCommit>("bookings", {
        owner: {
          phone: fullPhone(),
          subject: form.subject ?? undefined,
        },
        vehicle: {
          vin: form.vin || undefined,
          make: form.vehicle?.make,
          model: form.vehicle?.model,
          year: form.vehicle?.year,
        },
        issue: {
          symptoms: form.symptoms,
          canDriveSafely: form.canDriveSafely,
          redFlags: form.redFlags,
        },
        safety: {
          severity: form.severity,
          rationale: form.rationale,
          triggered: form.triggered,
        },
        source: "web",
      });
      setBooking(data);
      setStep(5);
    });
  }

  return (
    <div className="space-y-10">
      <ProgressHairline step={step} t={t} />

      {globalError ? (
        <div
          role="alert"
          className="rounded-[var(--radius-md)] border border-[var(--color-crimson)] bg-[rgba(178,58,72,0.10)] px-5 py-4 text-[var(--text-control)] text-pearl"
        >
          {globalError}
        </div>
      ) : null}

      <StageWrap step={step} reduced={reduced}>
        {step === 1 ? (
          <StepOneSignIn
            t={t}
            form={form}
            errors={errors}
            pending={pending}
            patch={patch}
            onSendCode={onSendCode}
            onOtpVerify={onOtpVerify}
            onResend={onResend}
            openDial={() => setDialOpen(true)}
          />
        ) : null}
        {step === 2 ? (
          <StepTwoVehicle
            t={t}
            form={form}
            errors={errors}
            pending={pending}
            patch={patch}
            onVinChange={onVinChange}
            onNext={onVehicleNext}
            openIntegrations={() => setIntegrationsOpen(true)}
            onBack={() => setStep(1)}
          />
        ) : null}
        {step === 3 ? (
          <StepThreeSymptoms
            t={t}
            form={form}
            errors={errors}
            pending={pending}
            patch={patch}
            appendChip={appendChip}
            toggleFlag={toggleFlag}
            onAssess={onAssess}
            onBack={() => setStep(2)}
          />
        ) : null}
        {step === 4 && form.severity ? (
          <StepFourReview
            t={t}
            form={form}
            pending={pending}
            onConfirm={onConfirm}
            onEdit={(target) => setStep(target)}
          />
        ) : null}
        {step === 5 && booking ? (
          <StepFiveConfirm
            t={t}
            booking={booking}
            conversationId={conversationId}
            symptoms={form.symptoms}
            canonical={CANONICAL_NO_SAFETY_CERT}
          />
        ) : null}
      </StageWrap>

      <CountryDialDialog
        open={dialOpen}
        onOpenChange={setDialOpen}
        selected={form.countryDial}
        onSelect={(d) => {
          patch({ countryDial: d });
          setDialOpen(false);
        }}
      />

      <IntegrationsDialog
        open={integrationsOpen}
        onOpenChange={setIntegrationsOpen}
      />
    </div>
  );
}

// ---------- Progress hairline ----------

function ProgressHairline({
  step,
  t,
}: {
  step: Step;
  t: ReturnType<typeof useTranslations>;
}): React.JSX.Element {
  const labelKey = step === 5 ? "book.stepper.5" : `book.stepper.${step}`;
  return (
    <div className="flex flex-col gap-3">
      <SpecLabel>
        {t(labelKey as Parameters<typeof t>[0])}
      </SpecLabel>
      <ol
        aria-label={t("book.stepper.label")}
        className="grid grid-cols-4 gap-2"
      >
        {([1, 2, 3, 4] as const).map((n) => {
          const active = step === n || (step === 5 && n === 4);
          const done = step > n || (step === 5 && n <= 4);
          return (
            <li
              key={n}
              aria-current={step === n ? "step" : undefined}
              className="relative h-px overflow-hidden bg-[var(--color-hairline)]"
            >
              <span
                aria-hidden="true"
                className="block h-full transition-[width,background-color] duration-[var(--duration-state)] ease-[var(--ease-enter)]"
                style={{
                  width: done ? "100%" : active ? "100%" : "0%",
                  backgroundColor: active
                    ? "var(--color-accent-sky)"
                    : done
                      ? "var(--color-pearl-soft)"
                      : "transparent",
                  boxShadow: active
                    ? "0 0 12px rgba(79,183,255,0.55)"
                    : "none",
                }}
              />
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ---------- Stage wrap (slide + fade) ----------

function StageWrap({
  step,
  reduced,
  children,
}: {
  step: Step;
  reduced: boolean;
  children: ReactNode;
}): React.JSX.Element {
  const [shown, setShown] = useState(step);
  const [phase, setPhase] = useState<"in" | "out">("in");

  useEffect(() => {
    if (step === shown) return;
    setPhase("out");
    const id = window.setTimeout(
      () => {
        setShown(step);
        setPhase("in");
      },
      reduced ? 0 : 120,
    );
    return () => window.clearTimeout(id);
  }, [step, shown, reduced]);

  const transform = reduced
    ? "none"
    : phase === "in"
      ? "translateY(0)"
      : "translateY(12px)";

  return (
    <section
      key={shown}
      aria-live="polite"
      className="transition-[opacity,transform] duration-[var(--duration-state)] ease-[var(--ease-enter)]"
      style={{
        opacity: phase === "in" ? 1 : 0,
        transform,
      }}
    >
      {children}
    </section>
  );
}

// ---------- Step 1 ----------

function StepOneSignIn({
  t,
  form,
  errors,
  pending,
  patch,
  onSendCode,
  onOtpVerify,
  onResend,
  openDial,
}: {
  t: ReturnType<typeof useTranslations>;
  form: FormState;
  errors: Partial<Record<string, string>>;
  pending: boolean;
  patch: (p: Partial<FormState>) => void;
  onSendCode: () => void;
  onOtpVerify: () => void;
  onResend: () => void;
  openDial: () => void;
}): React.JSX.Element {
  return (
    <article className="space-y-8">
      <header className="space-y-3">
        <h2 className="font-[family-name:var(--font-display)] text-[var(--text-h1)] font-medium leading-[1.05] tracking-[var(--tracking-tight)] text-pearl">
          {t("book.step1.headline")}
        </h2>
        <p className="text-[var(--text-lg)] leading-[1.55] text-pearl-muted">
          {t("book.step1.subtitle")}
        </p>
      </header>

      {form.challengeId === null ? (
        <GlassPanel className="space-y-5">
          <label htmlFor="phone-local" className="block">
            <SpecLabel>{t("book.step1.phoneLabel")}</SpecLabel>
          </label>
          <div className="luxe-input flex min-h-[56px] items-stretch overflow-hidden rounded-[var(--radius-md)]">
            <button
              type="button"
              onClick={openDial}
              aria-label={t("book.step1.changeDial")}
              className="inline-flex items-center gap-2 border-r border-[var(--color-hairline)] bg-white/[0.03] px-4 text-[var(--text-control)] tracking-[var(--tracking-wide)] text-pearl hover:bg-white/[0.06]"
            >
              <span className="luxe-mono">{form.countryDial}</span>
              <span aria-hidden="true" className="text-pearl-soft">
                {chevron()}
              </span>
            </button>
            <input
              id="phone-local"
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              value={form.phoneLocal}
              onChange={(e) =>
                patch({ phoneLocal: e.target.value.replace(/[^0-9 ]/g, "") })
              }
              placeholder="98765 43210"
              className="block w-full bg-transparent px-4 text-[var(--text-body)] text-pearl placeholder:text-pearl-faint focus:outline-none"
            />
          </div>
          {errors.phone ? (
            <p
              role="alert"
              className="text-[var(--text-caption)] text-[var(--color-crimson)]"
            >
              {errors.phone}
            </p>
          ) : (
            <p className="text-[var(--text-caption)] text-pearl-soft">
              {t("book.step1.phoneHint")}
            </p>
          )}

          <div className="flex flex-col-reverse gap-3 pt-2 md:flex-row md:items-center md:justify-end">
            <Button
              variant="primary"
              size="lg"
              onClick={onSendCode}
              loading={pending}
              loadingText={t("book.progress.sendingOtp")}
              className="w-full md:w-auto"
            >
              {t("book.step1.sendOtp")}
            </Button>
          </div>
        </GlassPanel>
      ) : (
        <GlassPanel variant="elevated" className="space-y-6">
          <div className="space-y-2">
            <SpecLabel>{t("book.step1.otpLabel")}</SpecLabel>
            <p className="text-[var(--text-caption)] text-pearl-soft">
              {t("book.step1.otpHint", { phone: form.countryDial + " " + form.phoneLocal })}
            </p>
          </div>

          <OtpRow
            value={form.otp}
            onChange={(otp) => patch({ otp })}
            onComplete={onOtpVerify}
          />
          {errors.otp ? (
            <p
              role="alert"
              className="text-[var(--text-caption)] text-[var(--color-crimson)]"
            >
              {errors.otp}
            </p>
          ) : null}

          {form.demoCode ? (
            <p className="text-[var(--text-caption)] text-pearl-soft">
              <span className="luxe-mono uppercase tracking-[var(--tracking-wider)]">
                {t("book.step1.demoCode")}
              </span>{" "}
              <span className="luxe-mono text-pearl">{form.demoCode}</span>
            </p>
          ) : null}

          <div className="flex flex-col-reverse items-stretch gap-3 pt-2 md:flex-row md:items-center md:justify-between">
            <button
              type="button"
              onClick={onResend}
              className="text-left text-[var(--text-caption)] tracking-[var(--tracking-wide)] text-pearl-soft underline-offset-4 hover:text-pearl hover:underline"
            >
              {t("book.step1.resend")}
            </button>
            <Button
              variant="primary"
              size="lg"
              onClick={onOtpVerify}
              loading={pending}
              loadingText={t("book.progress.verifyingOtp")}
              className="w-full md:w-auto"
            >
              {t("book.step1.verify")}
            </Button>
          </div>
        </GlassPanel>
      )}
    </article>
  );
}

function OtpRow({
  value,
  onChange,
  onComplete,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  onComplete: () => void;
}): React.JSX.Element {
  const refs = useRef<Array<HTMLInputElement | null>>([]);

  function setAt(i: number, ch: string): void {
    const v = [...value];
    v[i] = ch;
    onChange(v);
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>, i: number): void {
    if (e.key === "Backspace" && !value[i] && i > 0) {
      const next = refs.current[i - 1];
      next?.focus();
    } else if (e.key === "ArrowLeft" && i > 0) {
      refs.current[i - 1]?.focus();
    } else if (e.key === "ArrowRight" && i < value.length - 1) {
      refs.current[i + 1]?.focus();
    } else if (e.key === "Enter" && value.every((c) => c.length === 1)) {
      onComplete();
    }
  }

  function onChangeAt(i: number, e: ChangeEvent<HTMLInputElement>): void {
    const ch = e.target.value.replace(/\D/g, "").slice(-1);
    setAt(i, ch);
    if (ch && i < value.length - 1) {
      refs.current[i + 1]?.focus();
    }
    if (ch && i === value.length - 1 && value.slice(0, -1).every((c) => c.length === 1)) {
      onComplete();
    }
  }

  function onPaste(e: React.ClipboardEvent<HTMLInputElement>): void {
    const txt = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (txt.length === 0) return;
    e.preventDefault();
    const v = ["", "", "", "", "", ""];
    for (let k = 0; k < txt.length; k++) v[k] = txt[k] ?? "";
    onChange(v);
    const last = Math.min(txt.length, 5);
    refs.current[last]?.focus();
    if (txt.length === 6) onComplete();
  }

  return (
    <div
      role="group"
      aria-label="One-time code"
      className="luxe-glass-muted grid grid-cols-6 overflow-hidden rounded-[var(--radius-md)]"
    >
      {value.map((ch, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={1}
          value={ch}
          aria-label={`Digit ${i + 1}`}
          onChange={(e) => onChangeAt(i, e)}
          onKeyDown={(e) => onKey(e, i)}
          onPaste={onPaste}
          className={[
            "luxe-mono h-16 w-full bg-transparent text-center text-[var(--text-h4)] text-pearl",
            "focus:outline-none focus:bg-[rgba(79,183,255,0.06)]",
            i < 5 ? "border-r border-[var(--color-hairline)]" : "",
          ].join(" ")}
        />
      ))}
    </div>
  );
}

// ---------- Step 2 ----------

function StepTwoVehicle({
  t,
  form,
  errors,
  pending,
  patch,
  onVinChange,
  onNext,
  openIntegrations,
  onBack,
}: {
  t: ReturnType<typeof useTranslations>;
  form: FormState;
  errors: Partial<Record<string, string>>;
  pending: boolean;
  patch: (p: Partial<FormState>) => void;
  onVinChange: (value: string) => void;
  onNext: () => void;
  openIntegrations: () => void;
  onBack: () => void;
}): React.JSX.Element {
  return (
    <article className="space-y-8">
      <header className="space-y-3">
        <h2 className="font-[family-name:var(--font-display)] text-[var(--text-h1)] font-medium leading-[1.05] tracking-[var(--tracking-tight)] text-pearl">
          {t("book.step2.headline")}
        </h2>
        <p className="text-[var(--text-lg)] leading-[1.55] text-pearl-muted">
          {t("book.step2.subtitle")}
        </p>
      </header>

      <GlassPanel className="space-y-6">
        <div className="space-y-2">
          <label htmlFor="vin">
            <SpecLabel>{t("book.step2.vinLabel")}</SpecLabel>
          </label>
          <Input
            id="vin"
            type="mono"
            value={form.vin}
            onChange={(e) => onVinChange(e.target.value)}
            placeholder="WDDUG8FB7LA000000"
            maxLength={17}
            aria-describedby="vin-help"
            className="uppercase"
          />
          <p id="vin-help" className="text-[var(--text-caption)] text-pearl-soft">
            {t("book.step2.vinHint")}
          </p>
          {errors.vin ? (
            <p role="alert" className="text-[var(--text-caption)] text-[var(--color-crimson)]">
              {errors.vin}
            </p>
          ) : null}
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="plate">
              <SpecLabel>{t("book.step2.plateLabel")}</SpecLabel>
            </label>
            <Input
              id="plate"
              value={form.plate}
              onChange={(e) =>
                patch({ plate: e.target.value.toUpperCase().slice(0, 12) })
              }
              placeholder="MH 12 AB 1234"
              className="uppercase"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="odo">
              <SpecLabel>{t("book.step2.odometerLabel")}</SpecLabel>
            </label>
            <Input
              id="odo"
              type="number"
              inputMode="numeric"
              value={form.odometerKm}
              onChange={(e) => patch({ odometerKm: e.target.value })}
              placeholder="42 000"
            />
          </div>
        </div>

        {form.vehicle ? (
          <DecodedPanel vehicle={form.vehicle} t={t} />
        ) : pending && form.vin.length === 17 ? (
          <p className="text-[var(--text-caption)] text-pearl-soft" aria-live="polite">
            {t("book.progress.decodingVin")}
          </p>
        ) : null}

        <div className="pt-1">
          <button
            type="button"
            onClick={openIntegrations}
            className="inline-flex items-center gap-2 text-[var(--text-control)] tracking-[var(--tracking-wide)] text-pearl-muted underline-offset-4 hover:text-pearl hover:underline"
          >
            {t("book.step2.connectedCar")}
            <span aria-hidden="true">{chevron()}</span>
          </button>
        </div>
      </GlassPanel>

      <div className="flex flex-col-reverse gap-3 md:flex-row md:items-center md:justify-between">
        <Button variant="ghost" size="md" onClick={onBack}>
          {t("book.back")}
        </Button>
        <Button
          variant="primary"
          size="lg"
          onClick={onNext}
          loading={pending}
          className="w-full md:w-auto"
        >
          {t("book.next")}
        </Button>
      </div>
    </article>
  );
}

function DecodedPanel({
  vehicle,
  t,
}: {
  vehicle: VinDecoded;
  t: ReturnType<typeof useTranslations>;
}): React.JSX.Element {
  return (
    <div
      className="vsbs-decoded-panel luxe-glass-muted overflow-hidden rounded-[var(--radius-md)] p-5"
      aria-live="polite"
    >
      <SpecLabel>{t("book.step2.decoded")}</SpecLabel>
      <dl className="luxe-mono mt-3 grid gap-3 text-[var(--text-control)] text-pearl md:grid-cols-4">
        <div>
          <dt className="text-pearl-soft">{t("book.step2.make")}</dt>
          <dd>{vehicle.make ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-pearl-soft">{t("book.step2.model")}</dt>
          <dd>{vehicle.model ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-pearl-soft">{t("book.step2.year")}</dt>
          <dd>{vehicle.year ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-pearl-soft">{t("book.step2.trim")}</dt>
          <dd>{vehicle.trim ?? "—"}</dd>
        </div>
      </dl>
    </div>
  );
}

// ---------- Step 3 ----------

function StepThreeSymptoms({
  t,
  form,
  errors,
  pending,
  patch,
  appendChip,
  toggleFlag,
  onAssess,
  onBack,
}: {
  t: ReturnType<typeof useTranslations>;
  form: FormState;
  errors: Partial<Record<string, string>>;
  pending: boolean;
  patch: (p: Partial<FormState>) => void;
  appendChip: (s: string) => void;
  toggleFlag: (f: RedFlag) => void;
  onAssess: () => void;
  onBack: () => void;
}): React.JSX.Element {
  return (
    <article className="space-y-8">
      <header className="space-y-3">
        <h2 className="font-[family-name:var(--font-display)] text-[var(--text-h1)] font-medium leading-[1.05] tracking-[var(--tracking-tight)] text-pearl">
          {t("book.step3.headline")}
        </h2>
        <p className="text-[var(--text-lg)] leading-[1.55] text-pearl-muted">
          {t("book.step3.subtitle")}
        </p>
      </header>

      <GlassPanel className="space-y-6">
        <div className="flex flex-wrap gap-2" aria-label={t("book.step3.chipsLabel")}>
          {SUGGESTION_CHIPS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => appendChip(c)}
              className="luxe-glass-muted inline-flex items-center rounded-[var(--radius-pill,999px)] border border-[var(--color-hairline)] px-4 py-2 text-[var(--text-caption)] tracking-[var(--tracking-wide)] text-pearl hover:[border-color:var(--color-copper)]"
            >
              {c}
            </button>
          ))}
        </div>

        <div className="space-y-2">
          <label htmlFor="symptoms">
            <SpecLabel>{t("book.step3.symptomsLabel")}</SpecLabel>
          </label>
          <Textarea
            id="symptoms"
            value={form.symptoms}
            onChange={(e) => patch({ symptoms: e.target.value.slice(0, 1000) })}
            rows={6}
            placeholder={t("book.step3.symptomsPlaceholder")}
            className="!min-h-[200px]"
            aria-describedby="symptoms-help"
          />
          <p id="symptoms-help" className="text-[var(--text-caption)] text-pearl-soft">
            {form.symptoms.length} / 1000
          </p>
          {errors.symptoms ? (
            <p role="alert" className="text-[var(--text-caption)] text-[var(--color-crimson)]">
              {errors.symptoms}
            </p>
          ) : null}
        </div>

        <div className="grid grid-cols-3 gap-3" aria-label={t("book.step3.subFlows")}>
          {[
            { href: "/book/photo", key: "photo" as const },
            { href: "/book/voice", key: "voice" as const },
            { href: "/book/noise", key: "noise" as const },
          ].map((it) => (
            <a
              key={it.key}
              href={it.href}
              className="luxe-glass-muted flex flex-col items-center justify-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-hairline)] px-4 py-5 text-pearl hover:[border-color:var(--color-hairline-hover)]"
            >
              <span aria-hidden="true">{glyph(it.key)}</span>
              <span className="luxe-mono text-[var(--text-caption)] uppercase tracking-[var(--tracking-wider)] text-pearl-soft">
                {t(`book.step3.subflow.${it.key}` as Parameters<typeof t>[0])}
              </span>
            </a>
          ))}
        </div>

        <fieldset className="space-y-3">
          <legend>
            <SpecLabel>{t("book.step3.canDriveLabel")}</SpecLabel>
          </legend>
          <div className="grid gap-2 md:grid-cols-2">
            {(
              [
                "yes-confidently",
                "yes-cautiously",
                "unsure",
                "no",
                "already-stranded",
              ] as const
            ).map((v) => {
              const selected = form.canDriveSafely === v;
              return (
                <label
                  key={v}
                  className={[
                    "flex cursor-pointer items-center gap-3 rounded-[var(--radius-md)] border px-4 py-3 text-[var(--text-control)] text-pearl transition-colors",
                    selected
                      ? "border-[var(--color-copper)] bg-[rgba(201,163,106,0.06)]"
                      : "border-[var(--color-hairline)] hover:[border-color:var(--color-hairline-hover)]",
                  ].join(" ")}
                >
                  <input
                    type="radio"
                    name="canDrive"
                    value={v}
                    checked={selected}
                    onChange={() => patch({ canDriveSafely: v })}
                    className="h-4 w-4 accent-[var(--color-copper)]"
                  />
                  <span>{t(`book.step3.canDrive.${v}` as Parameters<typeof t>[0])}</span>
                </label>
              );
            })}
          </div>
          {errors.canDrive ? (
            <p role="alert" className="text-[var(--text-caption)] text-[var(--color-crimson)]">
              {errors.canDrive}
            </p>
          ) : null}
        </fieldset>

        <fieldset className="space-y-3">
          <legend>
            <SpecLabel>{t("book.step3.redFlagsLabel")}</SpecLabel>
          </legend>
          <ul className="grid gap-2 md:grid-cols-2">
            {RED_FLAGS.map((f) => {
              const checked = form.redFlags.includes(f);
              return (
                <li key={f}>
                  <label
                    className={[
                      "flex cursor-pointer items-center gap-3 rounded-[var(--radius-md)] border px-4 py-3 text-[var(--text-control)] text-pearl",
                      checked
                        ? "border-[var(--color-crimson)] bg-[rgba(178,58,72,0.10)]"
                        : "border-[var(--color-hairline)] hover:[border-color:var(--color-hairline-hover)]",
                    ].join(" ")}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleFlag(f)}
                      className="h-4 w-4 accent-[var(--color-crimson)]"
                    />
                    <span>{t(`book.redFlags.${f}` as Parameters<typeof t>[0])}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
      </GlassPanel>

      <div className="flex flex-col-reverse gap-3 md:flex-row md:items-center md:justify-between">
        <Button variant="ghost" size="md" onClick={onBack}>
          {t("book.back")}
        </Button>
        <Button
          variant="primary"
          size="lg"
          onClick={onAssess}
          loading={pending}
          loadingText={t("book.progress.assessingSafety")}
          className="w-full md:w-auto"
        >
          {t("book.step3.assess")}
        </Button>
      </div>
    </article>
  );
}

// ---------- Step 4 ----------

function StepFourReview({
  t,
  form,
  pending,
  onConfirm,
  onEdit,
}: {
  t: ReturnType<typeof useTranslations>;
  form: FormState;
  pending: boolean;
  onConfirm: () => void;
  onEdit: (target: Step) => void;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const symptomsLine = form.symptoms.length > 240 && !expanded
    ? form.symptoms.slice(0, 240) + "…"
    : form.symptoms;

  const severity = form.severity ?? "green";
  const action: Record<Severity, string> = useMemo(
    () => ({
      green: t("book.step4.action.green"),
      amber: t("book.step4.action.amber"),
      red: t("book.step4.action.red"),
    }),
    [t],
  );

  const wellbeingValue = severity === "red" ? "42" : severity === "amber" ? "68" : "84";
  const wellbeingStatus: "ok" | "watch" | "alert" =
    severity === "red" ? "alert" : severity === "amber" ? "watch" : "ok";

  return (
    <article className="space-y-8">
      <header className="space-y-3">
        <h2 className="font-[family-name:var(--font-display)] text-[var(--text-h1)] font-medium leading-[1.05] tracking-[var(--tracking-tight)] text-pearl">
          {t("book.step4.headline")}
        </h2>
        <p className="text-[var(--text-lg)] leading-[1.55] text-pearl-muted">
          {t("book.step4.subtitle")}
        </p>
      </header>

      <GlassPanel variant="elevated" className="space-y-7">
        <ReviewRow
          label={t("book.step4.field.vehicle")}
          editLabel={t("book.step4.edit")}
          onEdit={() => onEdit(2)}
        >
          <p className="luxe-mono text-pearl">
            {[form.vehicle?.year, form.vehicle?.make, form.vehicle?.model]
              .filter(Boolean)
              .join(" ") || form.vin || "—"}
          </p>
          {form.plate ? (
            <p className="luxe-mono text-[var(--text-caption)] uppercase text-pearl-soft">
              {form.plate}
            </p>
          ) : null}
        </ReviewRow>

        <ReviewRow
          label={t("book.step4.field.symptoms")}
          editLabel={t("book.step4.edit")}
          onEdit={() => onEdit(3)}
        >
          <p className="text-[var(--text-control)] leading-[1.6] text-pearl">
            {symptomsLine}
          </p>
          {form.symptoms.length > 240 ? (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="text-[var(--text-caption)] tracking-[var(--tracking-wide)] text-pearl-soft underline-offset-4 hover:text-pearl hover:underline"
            >
              {expanded ? t("book.step4.showLess") : t("book.step4.showAll")}
            </button>
          ) : null}
        </ReviewRow>

        <ReviewRow
          label={t("book.step4.field.action")}
          editLabel={t("book.step4.edit")}
          onEdit={() => onEdit(3)}
        >
          <p className="text-[var(--text-control)] leading-[1.6] text-pearl">
            {action[severity]}
          </p>
          {form.rationale ? (
            <p className="text-[var(--text-caption)] text-pearl-soft">
              {form.rationale}
            </p>
          ) : null}
        </ReviewRow>

        <ReviewRow
          label={t("book.step4.field.serviceCentre")}
          editLabel={t("book.step4.edit")}
          onEdit={() => onEdit(2)}
        >
          <p className="text-[var(--text-control)] text-pearl">
            {t("book.step4.shortlist")}
          </p>
          <p className="luxe-mono text-[var(--text-caption)] text-pearl-soft">
            {t("book.step4.shortlistMeta")}
          </p>
        </ReviewRow>

        <ReviewRow label={t("book.step4.field.priceBand")}>
          <p className="luxe-mono text-pearl">{t("book.step4.priceBandValue")}</p>
          <p className="text-[var(--text-caption)] text-pearl-soft">
            {t("book.step4.priceBandHint")}
          </p>
        </ReviewRow>

        <div>
          <SpecLabel>{t("book.step4.field.wellbeing")}</SpecLabel>
          <div className="mt-3">
            <KPIBlock
              label={t("book.step4.wellbeingLabel")}
              value={wellbeingValue}
              unit="/ 100"
              status={wellbeingStatus}
              description={t(`book.severity.${severity}`)}
              size="md"
            />
          </div>
        </div>
      </GlassPanel>

      <div className="space-y-4">
        <p className="text-[var(--text-caption)] text-pearl-soft">
          {t("book.step4.authorise")}
        </p>
        <div className="flex flex-col-reverse gap-3 md:flex-row md:items-center md:justify-between">
          <Button variant="ghost" size="md" onClick={() => onEdit(3)}>
            {t("book.back")}
          </Button>
          <Button
            variant="primary"
            size="lg"
            onClick={onConfirm}
            loading={pending}
            loadingText={t("book.progress.confirming")}
            className="w-full md:w-auto"
          >
            {t("book.step4.confirm")}
          </Button>
        </div>
      </div>
    </article>
  );
}

function ReviewRow({
  label,
  editLabel,
  onEdit,
  children,
}: {
  label: string;
  editLabel?: string;
  onEdit?: () => void;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2 border-b border-[var(--color-hairline)] pb-5 last:border-b-0 last:pb-0">
      <div className="flex items-center justify-between">
        <SpecLabel>{label}</SpecLabel>
        {onEdit && editLabel ? (
          <button
            type="button"
            onClick={onEdit}
            className="text-[var(--text-caption)] tracking-[var(--tracking-wide)] text-pearl-soft underline-offset-4 hover:text-pearl hover:underline"
          >
            {editLabel}
          </button>
        ) : null}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

// ---------- Step 5: Confirm + concierge ----------

function StepFiveConfirm({
  t,
  booking,
  conversationId,
  symptoms,
  canonical,
}: {
  t: ReturnType<typeof useTranslations>;
  booking: BookingCommit;
  conversationId: string;
  symptoms: string;
  canonical: string;
}): React.JSX.Element {
  return (
    <article
      className="relative isolate overflow-hidden rounded-[var(--radius-xl)] px-2 py-2"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-[var(--radius-xl)]"
      >
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: 'url("/images/concierge-hand.png")',
            backgroundSize: "cover",
            backgroundPosition: "center",
            opacity: 0.14,
            filter: "blur(24px) saturate(115%)",
          }}
        />
        <AmbientGlow tone="copper" className="!inset-[-30%_-10%_auto_auto] !w-[70%] !h-[70%]" />
      </div>

      <header className="space-y-3 px-1">
        <div className="flex items-center gap-3">
          <GoldSeal size={24} label={t("book.step5.sealLabel")} />
          <SpecLabel>{t("book.step5.eyebrow")}</SpecLabel>
        </div>
        <h2
          className="font-[family-name:var(--font-display)] font-medium leading-[1.02] tracking-[var(--tracking-tight)] text-pearl"
          style={{ fontSize: "clamp(3.5rem, 9vw, 6rem)" }}
        >
          {t("book.step5.headline")}
        </h2>
        <p className="text-[var(--text-lg)] leading-[1.55] text-pearl-muted">
          {t("book.step5.subtitle")}
        </p>
      </header>

      <div className="mt-8">
        <ConciergeRunner
          conversationId={conversationId}
          userMessage={symptoms || t("book.step5.fallbackMessage")}
          bookingId={booking.id}
          canonicalNoSafetyAdvisory={canonical}
        />
      </div>
    </article>
  );
}

// ---------- Dialogs ----------

function CountryDialDialog({
  open,
  onOpenChange,
  selected,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  selected: string;
  onSelect: (dial: string) => void;
}): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Select your country code</DialogTitle>
        <DialogDescription>
          We will text the one-time code to a number with this prefix.
        </DialogDescription>
        <ul className="mt-6 grid max-h-[420px] grid-cols-1 gap-1 overflow-auto md:grid-cols-2">
          {DIAL_CODES.map((c) => {
            const active = c.dial === selected;
            return (
              <li key={c.iso}>
                <button
                  type="button"
                  onClick={() => onSelect(c.dial)}
                  aria-pressed={active}
                  className={[
                    "flex w-full items-center justify-between rounded-[var(--radius-md)] border px-4 py-3 text-left text-[var(--text-control)] text-pearl",
                    active
                      ? "border-[var(--color-copper)] bg-[rgba(201,163,106,0.08)]"
                      : "border-[var(--color-hairline)] hover:[border-color:var(--color-hairline-hover)]",
                  ].join(" ")}
                >
                  <span>{c.name}</span>
                  <span className="luxe-mono text-pearl-soft">{c.dial}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <DialogFooter>
          <DialogClose className="luxe-glass rounded-[var(--radius-md)] px-5 py-2 text-[var(--text-control)] tracking-[var(--tracking-wide)] text-pearl">
            Done
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function IntegrationsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
}): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Connected car integrations</DialogTitle>
        <DialogDescription>
          We pull the VIN, odometer, and fault codes directly from your OEM account.
          Only Mercedes me is live today.
        </DialogDescription>
        <ul className="mt-6 space-y-2">
          {INTEGRATIONS.map((it) => (
            <li
              key={it.id}
              className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--color-hairline)] bg-white/[0.02] px-4 py-3"
            >
              <span className="text-[var(--text-control)] text-pearl">{it.name}</span>
              {it.available ? (
                <span className="inline-flex items-center gap-2 text-[var(--text-caption)] tracking-[var(--tracking-wider)] uppercase text-[var(--color-copper)]">
                  <GoldSeal size={14} label="Available" />
                  Available
                </span>
              ) : (
                <span className="luxe-mono text-[var(--text-caption)] uppercase tracking-[var(--tracking-wider)] text-pearl-soft">
                  Coming soon
                </span>
              )}
            </li>
          ))}
        </ul>
        <DialogFooter>
          <DialogClose className="luxe-glass rounded-[var(--radius-md)] px-5 py-2 text-[var(--text-control)] tracking-[var(--tracking-wide)] text-pearl">
            Close
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- glyphs ----------

function chevron(): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M3 5l4 4 4-4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function glyph(kind: "photo" | "voice" | "noise"): React.JSX.Element {
  const stroke = "var(--color-pearl-soft)";
  if (kind === "photo") {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4 8h3l1.5-2h7L17 8h3v11H4V8z" stroke={stroke} strokeWidth="1.4" />
        <circle cx="12" cy="13.5" r="3.5" stroke={stroke} strokeWidth="1.4" />
      </svg>
    );
  }
  if (kind === "voice") {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="9" y="3" width="6" height="12" rx="3" stroke={stroke} strokeWidth="1.4" />
        <path d="M5 11a7 7 0 0 0 14 0M12 18v3" stroke={stroke} strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 12h2l2-6 3 12 3-9 2 6h6"
        stroke={stroke}
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
