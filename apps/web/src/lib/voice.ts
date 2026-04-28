"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Streaming voice intake. The hook exposes a small API:
//   const { state, partial, error, start, stop } = useVoiceIntake({
//     onPartial, onFinal, onError,
//   });
//
// In the live profile we open a WebSocket to the API's voice gateway
// (which talks to Gemini Live). In the sim profile we run an entirely
// in-browser scripted utterance generator that exercises the same
// state machine (silent → partial → final → idle), so the UI can be
// developed and tested without any network or microphone access.
//
// `barge-in`: if the hook is already speaking the result via TTS and
// `start()` is called again, the playback is cancelled before the new
// turn begins. This matches the OpenAI/Gemini Live default behaviour.

export type VoiceState = "idle" | "listening" | "thinking" | "speaking" | "error";

export interface VoiceIntakeCallbacks {
  onPartial?: (text: string) => void;
  onFinal?: (text: string) => void;
  onError?: (err: Error) => void;
}

export interface VoiceIntakeApi {
  state: VoiceState;
  partial: string;
  level: number;
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
  cancelTts: () => void;
}

interface VoiceConfig {
  /** Driver: "auto" picks WebSocket if available, falls back to "sim". */
  driver?: "auto" | "ws" | "sim";
  /** API base for the voice gateway. */
  gatewayPath?: string;
  /** Sample rate for capture and worklet. */
  sampleRate?: number;
}

const DEFAULT_GATEWAY = "/api/proxy/voice/stream";

export function useVoiceIntake(
  cb: VoiceIntakeCallbacks = {},
  config: VoiceConfig = {},
): VoiceIntakeApi {
  const { driver = "auto", gatewayPath = DEFAULT_GATEWAY, sampleRate = 16000 } = config;

  const [state, setState] = useState<VoiceState>("idle");
  const [partial, setPartial] = useState<string>("");
  const [level, setLevel] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  const ws = useRef<WebSocket | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);
  const node = useRef<AudioWorkletNode | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const utterance = useRef<SpeechSynthesisUtterance | null>(null);
  const simTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cbRef = useRef<VoiceIntakeCallbacks>(cb);
  cbRef.current = cb;

  const cancelTts = useCallback((): void => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    utterance.current = null;
  }, []);

  const teardown = useCallback((): void => {
    if (simTimer.current) {
      clearTimeout(simTimer.current);
      simTimer.current = null;
    }
    if (node.current) {
      try {
        node.current.disconnect();
      } catch {
        /* node already disposed */
      }
      node.current = null;
    }
    if (stream.current) {
      for (const t of stream.current.getTracks()) t.stop();
      stream.current = null;
    }
    if (audioCtx.current && audioCtx.current.state !== "closed") {
      void audioCtx.current.close();
    }
    audioCtx.current = null;
    if (ws.current) {
      try {
        ws.current.close();
      } catch {
        /* ws already closed */
      }
      ws.current = null;
    }
  }, []);

  useEffect(() => () => teardown(), [teardown]);

  const handleError = useCallback((e: Error) => {
    setState("error");
    setError(e.message);
    cbRef.current.onError?.(e);
    teardown();
  }, [teardown]);

  const speak = useCallback((text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    cancelTts();
    setState("speaking");
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1;
    u.pitch = 1;
    u.onend = () => setState("idle");
    u.onerror = () => setState("idle");
    utterance.current = u;
    window.speechSynthesis.speak(u);
  }, [cancelTts]);

  const finish = useCallback((finalText: string) => {
    setPartial("");
    setState("thinking");
    cbRef.current.onFinal?.(finalText);
    speak(finalText);
  }, [speak]);

  const startSim = useCallback(async (): Promise<void> => {
    cancelTts();
    setError(null);
    setState("listening");
    setPartial("");
    const fullText = "My 2024 Honda Civic is grinding when I press the brakes.";
    let i = 0;
    const tick = (): void => {
      i = Math.min(fullText.length, i + 4);
      const slice = fullText.slice(0, i);
      setPartial(slice);
      cbRef.current.onPartial?.(slice);
      if (i < fullText.length) {
        simTimer.current = setTimeout(tick, 80);
      } else {
        finish(fullText);
      }
    };
    simTimer.current = setTimeout(tick, 80);
  }, [cancelTts, finish]);

  const startWs = useCallback(async (): Promise<void> => {
    cancelTts();
    setError(null);
    setState("listening");
    setPartial("");

    const url = new URL(gatewayPath, typeof window !== "undefined" ? window.location.href : "http://localhost");
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(url.toString());
    ws.current = socket;
    socket.binaryType = "arraybuffer";
    socket.onmessage = (e) => {
      try {
        const msg = JSON.parse(typeof e.data === "string" ? e.data : new TextDecoder().decode(new Uint8Array(e.data as ArrayBuffer))) as
          | { kind: "partial"; text: string }
          | { kind: "final"; text: string }
          | { kind: "error"; message: string };
        if (msg.kind === "partial") {
          setPartial(msg.text);
          cbRef.current.onPartial?.(msg.text);
        } else if (msg.kind === "final") {
          finish(msg.text);
        } else if (msg.kind === "error") {
          handleError(new Error(msg.message));
        }
      } catch (err) {
        handleError(new Error(`bad gateway frame: ${String(err)}`));
      }
    };
    socket.onerror = () => handleError(new Error("voice gateway connection error"));

    try {
      const media = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate, echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
      stream.current = media;
      const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)({
        sampleRate,
      });
      audioCtx.current = ctx;
      const blobUrl = workletBlobUrl();
      await ctx.audioWorklet.addModule(blobUrl);
      const src = ctx.createMediaStreamSource(media);
      const worklet = new AudioWorkletNode(ctx, "vsbs-mic-worklet");
      worklet.port.onmessage = (e) => {
        const data = e.data as { pcm?: Int16Array; rms?: number };
        if (data.rms !== undefined) setLevel(data.rms);
        if (data.pcm && socket.readyState === WebSocket.OPEN) {
          socket.send(data.pcm.buffer);
        }
      };
      node.current = worklet;
      src.connect(worklet).connect(ctx.destination);
    } catch (err) {
      handleError(err instanceof Error ? err : new Error(String(err)));
    }
  }, [cancelTts, finish, gatewayPath, handleError, sampleRate]);

  const start = useCallback(async (): Promise<void> => {
    cancelTts();
    if (driver === "sim") return startSim();
    if (driver === "ws") return startWs();
    // auto: prefer ws when WebSocket exists; otherwise sim.
    if (typeof window !== "undefined" && "WebSocket" in window && "mediaDevices" in navigator) {
      try {
        await startWs();
      } catch {
        await startSim();
      }
      return;
    }
    return startSim();
  }, [cancelTts, driver, startSim, startWs]);

  const stop = useCallback((): void => {
    teardown();
    cancelTts();
    setState("idle");
    setPartial("");
    setLevel(0);
  }, [teardown, cancelTts]);

  return { state, partial, level, error, start, stop, cancelTts };
}

// AudioWorklet processor source. We keep it inline so there is no
// extra build step; the URL is constructed on demand from a Blob. This
// is safe under the strict CSP because the worklet runs in its own
// scope and the spec allows blob: as a worklet module URL.
function workletBlobUrl(): string {
  const src = `
    class VsbsMicWorklet extends AudioWorkletProcessor {
      process(inputs) {
        const input = inputs[0];
        if (!input || !input[0]) return true;
        const ch = input[0];
        let sum = 0;
        const pcm = new Int16Array(ch.length);
        for (let i = 0; i < ch.length; i++) {
          const s = Math.max(-1, Math.min(1, ch[i]));
          pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
          sum += s * s;
        }
        const rms = Math.sqrt(sum / ch.length);
        this.port.postMessage({ pcm, rms }, [pcm.buffer]);
        return true;
      }
    }
    registerProcessor("vsbs-mic-worklet", VsbsMicWorklet);
  `;
  const blob = new Blob([src], { type: "application/javascript" });
  return URL.createObjectURL(blob);
}
