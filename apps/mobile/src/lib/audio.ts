// =============================================================================
// Audio capture + upload pipeline.
//
// Uses expo-av's `Audio.Recording` to capture engine / brake noise. We
// preset the high-quality recording option which yields 44.1 kHz mono
// PCM wrapped in m4a (AAC). The diagnosis specialist on the API side
// runs the file through a mel-spectrogram + reference library matcher
// (docs/research/wellbeing.md §6).
//
// PII rule: we capture only when the user explicitly taps "record" and
// stop on the first navigation event. The recording starts a session-
// scoped audio session (Apple AVAudioSession category .record) that does
// not persist across navigation.
// =============================================================================

import { Audio } from "expo-av";
import * as SecureStore from "expo-secure-store";

import { resolveBaseUrl } from "./region";

export interface AudioCapture {
  uri: string;
  durationMs: number;
}

export async function ensureAudioPermission(): Promise<boolean> {
  const { status } = await Audio.requestPermissionsAsync();
  return status === "granted";
}

export interface RecordingHandle {
  stop: () => Promise<AudioCapture>;
  cancel: () => Promise<void>;
}

export async function startRecording(): Promise<RecordingHandle> {
  const granted = await ensureAudioPermission();
  if (!granted) throw new Error("Microphone permission denied");

  await Audio.setAudioModeAsync({
    allowsRecordingIOS: true,
    playsInSilentModeIOS: true,
    staysActiveInBackground: false,
    shouldDuckAndroid: true,
    playThroughEarpieceAndroid: false,
  });

  const recording = new Audio.Recording();
  await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
  await recording.startAsync();
  const startedAt = Date.now();

  return {
    async stop(): Promise<AudioCapture> {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      if (!uri) throw new Error("Recording produced no URI");
      return { uri, durationMs: Date.now() - startedAt };
    },
    async cancel() {
      try {
        await recording.stopAndUnloadAsync();
      } catch {
        /* recording was never started or already stopped */
      }
    },
  };
}

export type AudioKind = "engine-noise" | "brake-noise" | "rattle" | "other";

export async function uploadAudio(opts: {
  capture: AudioCapture;
  kind: AudioKind;
  bookingId?: string;
}): Promise<{ url: string }> {
  const base = await resolveBaseUrl();
  const form = new FormData();
  form.append(
    "file",
    {
      uri: opts.capture.uri,
      name: `${opts.kind}.m4a`,
      type: "audio/mp4",
    } as unknown as Blob,
  );
  form.append("kind", opts.kind);
  form.append("durationMs", String(opts.capture.durationMs));
  if (opts.bookingId) form.append("bookingId", opts.bookingId);

  const headers: Record<string, string> = {};
  const token = await SecureStore.getItemAsync("vsbs.session.token");
  if (token) headers["authorization"] = `Bearer ${token}`;

  const res = await fetch(`${base}/v1/intake/audio`, {
    method: "POST",
    headers,
    body: form as unknown as BodyInit,
  });
  if (!res.ok) throw new Error(`Audio upload failed: HTTP ${res.status}`);
  const json: unknown = await res.json();
  if (
    typeof json !== "object" ||
    json === null ||
    !("data" in json) ||
    typeof (json as { data: unknown }).data !== "object"
  ) {
    throw new Error("Audio upload: malformed response");
  }
  const data = (json as { data: { url?: unknown } }).data;
  if (typeof data.url !== "string") throw new Error("Audio upload: missing url");
  return { url: data.url };
}
