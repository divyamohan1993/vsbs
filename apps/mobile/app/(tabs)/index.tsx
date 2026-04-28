// Home tab. Shows the welcome banner, the active booking summary if any,
// and CTAs to Book / Status / Autonomy. The active booking id is read
// from AsyncStorage; the timeline frame is read from /v1/bookings/:id.

import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { Banner, Button, Card, Screen } from "@/components/index";
import { useI18n } from "@/i18n/index";
import { apiClient, type Booking } from "@/lib/api";
import { track } from "@/lib/analytics";
import { useTheme } from "@/theme/index";

const LAST_BOOKING_KEY = "vsbs.last.booking";

export default function HomeScreen() {
  const { t } = useI18n();
  const { palette, spacing, typography } = useTheme();
  const router = useRouter();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    track("app_open");
    let cancelled = false;
    (async () => {
      try {
        const id = await AsyncStorage.getItem(LAST_BOOKING_KEY);
        if (!id) return;
        const b = await apiClient.getBooking(id);
        if (!cancelled) setBooking(b);
      } catch {
        // Booking expired or network down — silently fall through.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Screen>
      <Banner text={t.demo.banner} variant="warn" />
      <View style={{ gap: spacing.s }}>
        <Text style={{ ...typography.caption, color: palette.muted, textTransform: "uppercase", letterSpacing: 1 }}>
          {t.app.name}
        </Text>
        <Text style={{ ...typography.display, color: palette.onBackground }}>{t.app.tagline}</Text>
        <Text style={{ ...typography.body, color: palette.muted }}>{t.home.welcome}</Text>
      </View>

      <Card title={t.home.activeBooking}>
        {loading ? (
          <Text style={{ ...typography.body, color: palette.muted }}>...</Text>
        ) : booking ? (
          <View style={{ gap: spacing.s }}>
            <Text style={{ ...typography.title, color: palette.onSurface }}>
              {booking.vehicle.make ?? "Vehicle"} {booking.vehicle.model ?? ""}
            </Text>
            <Text style={{ ...typography.body, color: palette.muted }}>
              {booking.issue.symptoms}
            </Text>
            <Button
              label={t.home.statusCta}
              variant="secondary"
              onPress={() => router.push({ pathname: "/(tabs)/status/[id]", params: { id: booking.id } })}
              testID="open-status"
            />
          </View>
        ) : (
          <Text style={{ ...typography.body, color: palette.muted }}>{t.home.noActiveBooking}</Text>
        )}
      </Card>

      <Button
        label={t.home.bookCta}
        onPress={() => router.push("/(tabs)/book")}
        fullWidth
        testID="book-cta"
      />
    </Screen>
  );
}
