// Profile / consent / erasure screen.
//
// Three sections:
//   1. Theme + locale picker.
//   2. Consent toggles per DPDP purpose. Each is unbundled and revocable.
//   3. Right-to-erasure: DELETE /v1/me cascade.
//   4. Sign out.

import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import Toast from "react-native-toast-message";

import { Banner, Button, Card, Screen } from "@/components/index";
import { useI18n, SUPPORTED_LOCALES, type SupportedLocale } from "@/i18n/index";
import { useTheme } from "@/theme/index";
import { useAuth } from "@/providers/auth";
import { apiClient } from "@/lib/api";
import { track } from "@/lib/analytics";
import type { ThemeMode } from "@/theme/tokens";

const CONSENT_PURPOSES = [
  "service-fulfilment",
  "diagnostic-telemetry",
  "voice-photo-processing",
  "marketing",
  "ml-improvement-anonymised",
  "autonomy-delegation",
  "autopay-within-cap",
] as const;

function Toggle({ label, value, onToggle }: { label: string; value: boolean; onToggle: () => void }) {
  const { palette, radius, spacing, typography } = useTheme();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={label}
      onPress={onToggle}
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        minHeight: 44,
        paddingVertical: spacing.s,
      }}
    >
      <Text style={{ ...typography.body, color: palette.onSurface, flex: 1, paddingRight: spacing.m }}>{label}</Text>
      <View
        style={{
          width: 48,
          height: 28,
          borderRadius: radius.pill,
          backgroundColor: value ? palette.accent : palette.border,
          padding: 2,
          alignItems: value ? "flex-end" : "flex-start",
        }}
      >
        <View
          style={{
            width: 24,
            height: 24,
            borderRadius: radius.pill,
            backgroundColor: palette.surface,
          }}
        />
      </View>
    </Pressable>
  );
}

export default function MeScreen() {
  const { t, locale, setLocale } = useI18n();
  const { palette, spacing, typography, mode, setMode } = useTheme();
  const { signOut } = useAuth();
  const router = useRouter();
  const [consents, setConsents] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Default consent state. The real fetch lives behind /v1/me/consent
    // (owned by the API peer). We expose toggles immediately so the UI
    // is responsive offline.
    setConsents({
      "service-fulfilment": true,
      "diagnostic-telemetry": true,
      "voice-photo-processing": false,
      marketing: false,
      "ml-improvement-anonymised": false,
      "autonomy-delegation": false,
      "autopay-within-cap": false,
    });
  }, []);

  function toggleConsent(key: string) {
    setConsents((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      track("consent_changed", { consentPurpose: key, consentGranted: next[key] === true });
      return next;
    });
  }

  function handleErasure() {
    Alert.alert(t.me.erasure, t.me.erasureConfirm, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          setBusy(true);
          try {
            await apiClient.deleteSelf();
            track("erasure_requested", { result: "ok" });
            await signOut();
            router.replace("/(auth)/login");
            Toast.show({ type: "success", text1: "Account deleted" });
          } catch (err) {
            track("erasure_requested", { result: "fail" });
            Toast.show({ type: "error", text1: (err as Error).message });
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  }

  return (
    <Screen>
      <Banner text={t.demo.banner} variant="warn" />
      <Text style={{ ...typography.headline, color: palette.onBackground }}>{t.me.title}</Text>

      <Card title={t.me.theme}>
        <View style={{ flexDirection: "row", gap: spacing.s, flexWrap: "wrap" }}>
          {(["light", "dark", "high-contrast"] as ThemeMode[]).map((m) => (
            <Button
              key={m}
              label={
                m === "light" ? t.me.themeLight : m === "dark" ? t.me.themeDark : t.me.themeHigh
              }
              variant={mode === m ? "primary" : "secondary"}
              onPress={() => setMode(m)}
            />
          ))}
        </View>
      </Card>

      <Card title={t.me.locale}>
        <View style={{ flexDirection: "row", gap: spacing.s, flexWrap: "wrap" }}>
          {SUPPORTED_LOCALES.map((l: SupportedLocale) => (
            <Button
              key={l}
              label={l.toUpperCase()}
              variant={locale === l ? "primary" : "secondary"}
              onPress={() => setLocale(l)}
            />
          ))}
        </View>
      </Card>

      <Card title={t.me.consent}>
        {CONSENT_PURPOSES.map((p) => (
          <Toggle key={p} label={p} value={consents[p] ?? false} onToggle={() => toggleConsent(p)} />
        ))}
      </Card>

      <Card>
        <Button label={t.me.signOut} variant="secondary" onPress={async () => {
          await signOut();
          router.replace("/(auth)/login");
        }} fullWidth />
        <Button label={t.me.erasure} variant="danger" onPress={handleErasure} loading={busy} fullWidth />
      </Card>
    </Screen>
  );
}
