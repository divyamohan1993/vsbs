// Status screen. Subscribes to /v1/bookings/:id/stream via SSE and
// displays the rolling timeline. Each frame includes ETA + wellbeing
// score + plain-language explanation, mirroring docs/research/wellbeing.md.

import { useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";

import { Banner, Card, Screen } from "@/components/index";
import { useI18n } from "@/i18n/index";
import { apiClient } from "@/lib/api";
import { readSse } from "@/lib/sse";
import { useTheme } from "@/theme/index";

interface BookingFrame {
  at: string;
  status: string;
  etaMinutes: number;
  wellbeing: number;
  explanation: string;
}

function isFrame(v: unknown): v is BookingFrame {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as { at?: unknown }).at === "string" &&
    typeof (v as { status?: unknown }).status === "string" &&
    typeof (v as { etaMinutes?: unknown }).etaMinutes === "number" &&
    typeof (v as { wellbeing?: unknown }).wellbeing === "number" &&
    typeof (v as { explanation?: unknown }).explanation === "string"
  );
}

export default function StatusScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === "string" ? params.id : "demo";
  const { t } = useI18n();
  const { palette, spacing, typography } = useTheme();
  const [frames, setFrames] = useState<BookingFrame[]>([]);
  const [done, setDone] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    abortRef.current = ac;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiClient.openBookingStream(id, ac.signal);
        for await (const frame of readSse(res.body as ReadableStream<Uint8Array> | null)) {
          if (cancelled) break;
          if (frame.event === "frame") {
            try {
              const parsed: unknown = JSON.parse(frame.data);
              if (isFrame(parsed)) setFrames((prev) => [...prev, parsed]);
            } catch {
              /* ignore malformed frame */
            }
          } else if (frame.event === "end") {
            if (!cancelled) setDone(true);
            break;
          }
        }
      } catch {
        // Connection lost; UI shows the last known frames.
      }
    })();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [id]);

  const latest = frames[frames.length - 1];

  return (
    <Screen>
      <Banner text={done ? t.status.live : `${t.status.live}...`} variant={done ? "good" : "info"} />
      <Text style={{ ...typography.headline, color: palette.onBackground }}>
        {t.status.title} {id}
      </Text>
      {latest ? (
        <Card title={latest.status}>
          <View style={{ flexDirection: "row", gap: spacing.l }}>
            <View>
              <Text style={{ ...typography.caption, color: palette.muted }}>{t.status.eta}</Text>
              <Text style={{ ...typography.title, color: palette.onSurface }}>
                {latest.etaMinutes} {t.status.minutes}
              </Text>
            </View>
            <View>
              <Text style={{ ...typography.caption, color: palette.muted }}>{t.status.wellbeing}</Text>
              <Text style={{ ...typography.title, color: palette.onSurface }}>
                {(latest.wellbeing * 100).toFixed(0)}%
              </Text>
            </View>
          </View>
          <Text style={{ ...typography.body, color: palette.onSurface }}>{latest.explanation}</Text>
        </Card>
      ) : (
        <Card>
          <Text style={{ ...typography.body, color: palette.muted }}>{t.status.waiting}</Text>
        </Card>
      )}

      <Text style={{ ...typography.label, color: palette.muted }}>Timeline</Text>
      {frames.map((f, idx) => (
        <Card key={`${f.at}-${idx}`}>
          <Text style={{ ...typography.title, color: palette.onSurface }}>{f.status}</Text>
          <Text style={{ ...typography.caption, color: palette.muted }}>{new Date(f.at).toLocaleTimeString()}</Text>
          <Text style={{ ...typography.body, color: palette.onSurface }}>{f.explanation}</Text>
        </Card>
      ))}
    </Screen>
  );
}
