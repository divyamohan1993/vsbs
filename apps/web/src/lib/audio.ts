"use client";

// Audio intake — engine / brake / drivetrain noise classifier.
// The browser captures a short clip, computes a mel-spectrogram with
// the Web Audio AnalyserNode, and uploads both the raw WAV and the
// normalised feature vector to the API. The API's classifier compares
// the feature vector against a labelled reference library; in sim
// mode, a deterministic fixture is returned (brake-squeal, valve-tap,
// cv-joint-clunk, exhaust-leak, healthy).

export interface CapturedClip {
  wav: Blob;
  features: number[]; // 64 mel bins × 16 frames flattened = 1024 floats
  durationMs: number;
  sampleRate: number;
}

export interface AudioUploadResponse {
  ok: boolean;
  classification: {
    label: "brake-squeal" | "valve-tap" | "cv-joint-clunk" | "exhaust-leak" | "healthy" | "unknown";
    confidence: number;
    rationale: string;
    suggestedActions: string[];
  };
}

const SAMPLE_RATE = 16000;
const MEL_BINS = 64;
const FRAMES = 16;

export async function recordClip(
  durationMs: number,
  onLevel?: (rms: number) => void,
): Promise<CapturedClip> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices) {
    throw new Error("Microphone is not available in this environment");
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { sampleRate: SAMPLE_RATE, channelCount: 1, echoCancellation: false, noiseSuppression: false },
  });
  try {
    return await captureFromStream(stream, durationMs, onLevel);
  } finally {
    for (const t of stream.getTracks()) t.stop();
  }
}

async function captureFromStream(stream: MediaStream, durationMs: number, onLevel?: (rms: number) => void): Promise<CapturedClip> {
  const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)({
    sampleRate: SAMPLE_RATE,
  });
  const src = ctx.createMediaStreamSource(stream);
  const fftSize = 2048;
  const analyser = ctx.createAnalyser();
  analyser.fftSize = fftSize;
  analyser.smoothingTimeConstant = 0;
  src.connect(analyser);

  const sampleBuffer: Float32Array[] = [];
  const recorderProc = ctx.createScriptProcessor
    ? ctx.createScriptProcessor(fftSize, 1, 1)
    : null;
  // A ScriptProcessorNode is deprecated but it is still the most
  // portable way to capture raw PCM in browsers without an AudioWorklet
  // build pipeline. We accept the deprecation here because the recording
  // duration is bounded and short.
  if (recorderProc) {
    recorderProc.onaudioprocess = (ev) => {
      const ch = ev.inputBuffer.getChannelData(0);
      sampleBuffer.push(new Float32Array(ch));
      if (onLevel) {
        let sum = 0;
        for (let i = 0; i < ch.length; i++) sum += ch[i]! * ch[i]!;
        onLevel(Math.sqrt(sum / ch.length));
      }
    };
    src.connect(recorderProc);
    recorderProc.connect(ctx.destination);
  }

  const stopAt = Date.now() + durationMs;
  const frames: number[][] = [];
  const freq = new Uint8Array(analyser.frequencyBinCount);
  const filterbank = makeMelFilterbank(MEL_BINS, analyser.frequencyBinCount, ctx.sampleRate);

  while (Date.now() < stopAt) {
    analyser.getByteFrequencyData(freq);
    const mels = applyFilterbank(freq, filterbank);
    frames.push(mels);
    await new Promise((r) => setTimeout(r, durationMs / FRAMES));
    if (frames.length >= FRAMES) break;
  }

  if (recorderProc) {
    recorderProc.disconnect();
    recorderProc.onaudioprocess = null;
  }
  await ctx.close();

  while (frames.length < FRAMES) frames.push(new Array(MEL_BINS).fill(0));
  const features = frames.flat();
  const wav = encodeWav(sampleBuffer, ctx.sampleRate);
  return { wav, features, durationMs, sampleRate: ctx.sampleRate };
}

export async function uploadClip(clip: CapturedClip, intakeId: string, label: "engine" | "brake" | "drivetrain"): Promise<AudioUploadResponse> {
  const fd = new FormData();
  fd.set("intakeId", intakeId);
  fd.set("label", label);
  fd.set("durationMs", String(clip.durationMs));
  fd.set("sampleRate", String(clip.sampleRate));
  fd.set("features", JSON.stringify(clip.features));
  fd.set("clip", new File([clip.wav], `${label}.wav`, { type: "audio/wav" }));
  const res = await fetch("/api/proxy/intake/audio", { method: "POST", body: fd });
  if (!res.ok) {
    throw new Error(`Audio upload failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as AudioUploadResponse;
}

// ---- DSP helpers ----

function hzToMel(hz: number): number {
  return 2595 * Math.log10(1 + hz / 700);
}

function melToHz(mel: number): number {
  return 700 * (10 ** (mel / 2595) - 1);
}

function makeMelFilterbank(nBins: number, fftBins: number, sampleRate: number): number[][] {
  const lowMel = hzToMel(0);
  const highMel = hzToMel(sampleRate / 2);
  const points: number[] = new Array(nBins + 2);
  for (let i = 0; i < points.length; i++) {
    points[i] = melToHz(lowMel + ((highMel - lowMel) * i) / (points.length - 1));
  }
  const bin = (hz: number): number => Math.floor(((fftBins + 1) * hz) / (sampleRate / 2));
  const fb: number[][] = [];
  for (let m = 1; m <= nBins; m++) {
    const left = bin(points[m - 1]!);
    const center = bin(points[m]!);
    const right = bin(points[m + 1]!);
    const row: number[] = new Array(fftBins).fill(0);
    for (let k = left; k < center; k++) row[k] = (k - left) / Math.max(1, center - left);
    for (let k = center; k <= right; k++) row[k] = (right - k) / Math.max(1, right - center);
    fb.push(row);
  }
  return fb;
}

function applyFilterbank(freq: Uint8Array, fb: number[][]): number[] {
  const out: number[] = new Array(fb.length).fill(0);
  for (let m = 0; m < fb.length; m++) {
    const row = fb[m]!;
    let sum = 0;
    for (let k = 0; k < row.length; k++) sum += row[k]! * (freq[k]! / 255);
    out[m] = sum;
  }
  // log-mel
  return out.map((v) => Math.log10(1e-6 + v));
}

function encodeWav(chunks: Float32Array[], sampleRate: number): Blob {
  const total = chunks.reduce((a, c) => a + c.length, 0);
  const merged = new Float32Array(total);
  let o = 0;
  for (const c of chunks) {
    merged.set(c, o);
    o += c.length;
  }
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataLen = merged.length * bytesPerSample;
  const buf = new ArrayBuffer(44 + dataLen);
  const view = new DataView(buf);
  // RIFF header
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataLen, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataLen, true);
  // PCM samples
  let off = 44;
  for (let i = 0; i < merged.length; i++) {
    const s = Math.max(-1, Math.min(1, merged[i]!));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }
  return new Blob([buf], { type: "audio/wav" });
}

function writeString(view: DataView, offset: number, s: string): void {
  for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
}
