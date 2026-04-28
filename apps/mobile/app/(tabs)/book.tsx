// Booking wizard. Mirrors the apps/web 4+1 step flow, kept as a single
// stateful screen with progressive disclosure (the standard mobile
// pattern). Each step is gated on the previous step succeeding.
//
// Steps:
//   1. Sign in confirmation (if already signed in we skip).
//   2. Vehicle (VIN decode or manual fallback).
//   3. Symptoms + safety self-assessment.
//   4. Review.
//   5. Concierge (SSE stream of agent trace).

import { useRouter } from "expo-router";
import { useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Toast from "react-native-toast-message";

import { Banner, Button, Card, Screen, TextField } from "@/components/index";
import { useI18n } from "@/i18n/index";
import { apiClient, ApiError, type BookingCreate, type Booking } from "@/lib/api";
import { readSse } from "@/lib/sse";
import { track } from "@/lib/analytics";
import { useTheme } from "@/theme/index";

type CanDriveSafely = BookingCreate["issue"]["canDriveSafely"];

type Severity = "red" | "amber" | "green";

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

const LAST_BOOKING_KEY = "vsbs.last.booking";

interface VehicleDraft {
  vin: string;
  make: string;
  model: string;
  year: string;
}

interface IssueDraft {
  symptoms: string;
  canDriveSafely: CanDriveSafely | "";
  redFlags: string[];
}

function StepHeader({ step, title }: { step: number; title: string }) {
  const { palette, spacing, typography } = useTheme();
  return (
    <View style={{ gap: spacing.xs }}>
      <Text style={{ ...typography.caption, color: palette.muted, textTransform: "uppercase", letterSpacing: 1 }}>
        Step {step}
      </Text>
      <Text style={{ ...typography.headline, color: palette.onBackground }}>{title}</Text>
    </View>
  );
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const { palette, radius, spacing, typography } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      style={{
        minHeight: 44,
        paddingHorizontal: spacing.l,
        paddingVertical: spacing.s,
        borderRadius: radius.pill,
        backgroundColor: selected ? palette.accent : palette.surface,
        borderColor: selected ? palette.accent : palette.border,
        borderWidth: 1,
        justifyContent: "center",
      }}
    >
      <Text style={{ ...typography.label, color: selected ? palette.accentOn : palette.onSurface }}>{label}</Text>
    </Pressable>
  );
}

function severityFromSelfReport(canDrive: CanDriveSafely | "", redFlags: string[]): {
  severity: Severity;
  rationale: string;
  triggered: string[];
} {
  if (redFlags.length > 0) {
    return {
      severity: "red",
      rationale: `Self-reported red-flag conditions: ${redFlags.join(", ")}.`,
      triggered: redFlags,
    };
  }
  if (canDrive === "no" || canDrive === "already-stranded") {
    return {
      severity: "red",
      rationale: "Owner reports the vehicle is not driveable.",
      triggered: ["driver-reports-unsafe"],
    };
  }
  if (canDrive === "unsure" || canDrive === "yes-cautiously") {
    return {
      severity: "amber",
      rationale: "Owner is hesitant about driving — caution advised.",
      triggered: [],
    };
  }
  return { severity: "green", rationale: "Self-report indicates safe to drive.", triggered: [] };
}

export default function BookScreen() {
  const { t } = useI18n();
  const { palette, spacing, typography } = useTheme();
  const router = useRouter();

  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(2);
  const [vehicle, setVehicle] = useState<VehicleDraft>({ vin: "", make: "", model: "", year: "" });
  const [issue, setIssue] = useState<IssueDraft>({ symptoms: "", canDriveSafely: "", redFlags: [] });
  const [busy, setBusy] = useState(false);
  const [traceLines, setTraceLines] = useState<string[]>([]);
  const [bookingId, setBookingId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const safety = useMemo(() => severityFromSelfReport(issue.canDriveSafely, issue.redFlags), [issue]);

  async function decodeVin() {
    if (vehicle.vin.length !== 17) {
      Toast.show({ type: "error", text1: "VIN must be 17 characters" });
      return;
    }
    setBusy(true);
    try {
      const decoded = await apiClient.decodeVin(vehicle.vin.toUpperCase());
      setVehicle((v) => ({
        ...v,
        make: decoded.make ?? v.make,
        model: decoded.model ?? v.model,
        year: decoded.year ? String(decoded.year) : v.year,
      }));
    } catch (err) {
      const m = err instanceof ApiError ? err.message : "VIN decode failed";
      Toast.show({ type: "error", text1: m });
    } finally {
      setBusy(false);
    }
  }

  function toggleRedFlag(rf: string) {
    setIssue((prev) => ({
      ...prev,
      redFlags: prev.redFlags.includes(rf) ? prev.redFlags.filter((x) => x !== rf) : [...prev.redFlags, rf],
    }));
  }

  function canAdvance(): boolean {
    if (step === 2) return Boolean(vehicle.make && vehicle.model && vehicle.year);
    if (step === 3) return Boolean(issue.symptoms && issue.canDriveSafely);
    return true;
  }

  async function confirmBooking() {
    setBusy(true);
    try {
      const subject = await apiClient.getSubject();
      const phone = subject ?? "+910000000000";
      const yearNum = Number(vehicle.year);
      const payload: BookingCreate = {
        owner: { phone, ...(subject ? { subject } : {}) },
        vehicle: {
          ...(vehicle.vin ? { vin: vehicle.vin.toUpperCase() } : {}),
          ...(vehicle.make ? { make: vehicle.make } : {}),
          ...(vehicle.model ? { model: vehicle.model } : {}),
          ...(Number.isFinite(yearNum) && yearNum > 0 ? { year: yearNum } : {}),
        },
        issue: {
          symptoms: issue.symptoms,
          canDriveSafely: issue.canDriveSafely as CanDriveSafely,
          redFlags: issue.redFlags,
        },
        safety,
        source: "mobile",
      };
      const created: Booking = await apiClient.createBooking(payload);
      setBookingId(created.id);
      await AsyncStorage.setItem(LAST_BOOKING_KEY, created.id);
      track("book_confirmed", { result: "ok" });
      setStep(5);
      runConcierge(created.id);
    } catch (err) {
      track("book_confirmed", { result: "fail" });
      const m = err instanceof ApiError ? err.message : "Booking failed";
      Toast.show({ type: "error", text1: m });
    } finally {
      setBusy(false);
    }
  }

  async function runConcierge(id: string) {
    setTraceLines([]);
    const ac = new AbortController();
    abortRef.current?.abort();
    abortRef.current = ac;
    track("concierge_turn_started");
    try {
      const res = await apiClient.openConciergeStream(
        { conversationId: id, userMessage: issue.symptoms },
        ac.signal,
      );
      for await (const frame of readSse(res.body as ReadableStream<Uint8Array> | null)) {
        setTraceLines((lines) => [...lines, `[${frame.event}] ${truncate(frame.data, 120)}`]);
        if (frame.event === "final" || frame.event === "end") break;
      }
      track("concierge_turn_completed", { result: "ok" });
    } catch (err) {
      track("concierge_turn_completed", { result: "fail" });
      if ((err as { name?: string }).name !== "AbortError") {
        Toast.show({ type: "error", text1: "Concierge stream interrupted" });
      }
    }
  }

  function reset() {
    abortRef.current?.abort();
    setStep(2);
    setVehicle({ vin: "", make: "", model: "", year: "" });
    setIssue({ symptoms: "", canDriveSafely: "", redFlags: [] });
    setTraceLines([]);
    setBookingId(null);
  }

  return (
    <Screen>
      <Banner text={t.demo.banner} variant="warn" />
      <View style={{ flexDirection: "row", gap: spacing.xs }}>
        {[2, 3, 4, 5].map((n) => (
          <View
            key={n}
            accessibilityElementsHidden
            style={{
              flex: 1,
              height: 4,
              borderRadius: 2,
              backgroundColor: step >= n ? palette.accent : palette.border,
            }}
          />
        ))}
      </View>

      {step === 2 ? (
        <Card>
          <StepHeader step={1} title={t.book.step2} />
          <TextField
            label="VIN"
            value={vehicle.vin}
            onChangeText={(s) => setVehicle((v) => ({ ...v, vin: s.toUpperCase() }))}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={17}
            hint="17-character ISO 3779 VIN"
          />
          <Button label="Decode VIN" variant="secondary" loading={busy} onPress={decodeVin} testID="decode-vin" />
          <TextField label="Make" value={vehicle.make} onChangeText={(s) => setVehicle((v) => ({ ...v, make: s }))} />
          <TextField label="Model" value={vehicle.model} onChangeText={(s) => setVehicle((v) => ({ ...v, model: s }))} />
          <TextField
            label="Year"
            value={vehicle.year}
            onChangeText={(s) => setVehicle((v) => ({ ...v, year: s.replace(/[^0-9]/g, "") }))}
            keyboardType="number-pad"
            maxLength={4}
          />
          <Button label={t.book.next} onPress={() => setStep(3)} disabled={!canAdvance()} fullWidth testID="next-step" />
        </Card>
      ) : null}

      {step === 3 ? (
        <Card>
          <StepHeader step={2} title={t.book.step3} />
          <TextField
            label="What is happening?"
            value={issue.symptoms}
            onChangeText={(s) => setIssue((i) => ({ ...i, symptoms: s }))}
            multiline
            numberOfLines={4}
            style={{ minHeight: 96, textAlignVertical: "top" }}
          />
          <Text style={{ ...typography.label, color: palette.onSurface }}>Can you drive safely right now?</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.s }}>
            {(["yes-confidently", "yes-cautiously", "unsure", "no", "already-stranded"] as const).map((opt) => (
              <Chip
                key={opt}
                label={opt}
                selected={issue.canDriveSafely === opt}
                onPress={() => setIssue((i) => ({ ...i, canDriveSafely: opt }))}
              />
            ))}
          </View>
          <Text style={{ ...typography.label, color: palette.onSurface, marginTop: spacing.m }}>
            Any of these happening right now?
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.s }}>
            {RED_FLAGS.map((rf) => (
              <Chip key={rf} label={rf} selected={issue.redFlags.includes(rf)} onPress={() => toggleRedFlag(rf)} />
            ))}
          </View>
          <Button label={t.book.next} onPress={() => setStep(4)} disabled={!canAdvance()} fullWidth />
        </Card>
      ) : null}

      {step === 4 ? (
        <Card>
          <StepHeader step={3} title={t.book.step4} />
          <Text style={{ ...typography.body, color: palette.onSurface }}>
            Vehicle: {vehicle.make} {vehicle.model} {vehicle.year}
          </Text>
          <Text style={{ ...typography.body, color: palette.onSurface }}>Symptoms: {issue.symptoms}</Text>
          <Text style={{ ...typography.body, color: palette.onSurface }}>
            Safety: {safety.severity.toUpperCase()} — {safety.rationale}
          </Text>
          <Banner
            text={`Severity: ${safety.severity}`}
            variant={safety.severity === "red" ? "danger" : safety.severity === "amber" ? "warn" : "good"}
          />
          <Button label={t.book.confirm} onPress={confirmBooking} loading={busy} fullWidth testID="confirm-booking" />
          <Button label={t.book.back} variant="ghost" onPress={() => setStep(3)} />
        </Card>
      ) : null}

      {step === 5 && bookingId ? (
        <Card title={t.book.step5}>
          <Text style={{ ...typography.body, color: palette.onSurface }}>Booking #{bookingId}</Text>
          <View style={{ gap: spacing.xs }}>
            {traceLines.length === 0 ? (
              <Text style={{ ...typography.caption, color: palette.muted }}>Connecting to concierge...</Text>
            ) : (
              traceLines.map((line, idx) => (
                <Text key={idx} style={{ ...typography.caption, color: palette.muted, fontFamily: "Courier" }}>
                  {line}
                </Text>
              ))
            )}
          </View>
          <Button
            label="Open status"
            variant="secondary"
            onPress={() => router.push({ pathname: "/(tabs)/status/[id]", params: { id: bookingId } })}
          />
          <Button label="Start over" variant="ghost" onPress={reset} />
        </Card>
      ) : null}
    </Screen>
  );
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n)}...`;
}
