"use client";

// Photo intake. The browser captures from a getUserMedia stream, the
// EXIF block is stripped (we re-encode through a canvas, which the spec
// guarantees produces a metadata-free image), the canvas blob is
// compressed under a 1 MiB cap, and the result is uploaded to the API.

export interface CapturedPhoto {
  blob: Blob;
  width: number;
  height: number;
  mimeType: string;
  bytes: number;
}

export interface PhotoUploadResponse {
  ok: boolean;
  /** Server's deterministic finding (sim) or vision result (live). */
  finding: {
    label: string;
    confidence: number;
    rationale: string;
    suggestedActions: string[];
  };
}

const DEFAULT_MAX_DIM = 1600;
const DEFAULT_MAX_BYTES = 900 * 1024; // keep us under the 1 MiB body cap

export async function getCameraStream(constraints: MediaStreamConstraints = {
  video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
  audio: false,
}): Promise<MediaStream> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices) {
    throw new Error("Camera is not available in this environment");
  }
  return navigator.mediaDevices.getUserMedia(constraints);
}

export function stopStream(stream: MediaStream | null): void {
  if (!stream) return;
  for (const t of stream.getTracks()) t.stop();
}

export async function captureFromVideo(
  video: HTMLVideoElement,
  maxDim = DEFAULT_MAX_DIM,
  maxBytes = DEFAULT_MAX_BYTES,
): Promise<CapturedPhoto> {
  if (!video.videoWidth || !video.videoHeight) {
    throw new Error("Video stream is not yet ready");
  }
  const { width, height } = scaleDown(video.videoWidth, video.videoHeight, maxDim);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2d context is unavailable");
  ctx.drawImage(video, 0, 0, width, height);
  const blob = await compress(canvas, maxBytes);
  return { blob, width, height, mimeType: blob.type, bytes: blob.size };
}

export async function captureFromFile(file: File, maxDim = DEFAULT_MAX_DIM, maxBytes = DEFAULT_MAX_BYTES): Promise<CapturedPhoto> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = scaleDown(bitmap.width, bitmap.height, maxDim);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2d context is unavailable");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await compress(canvas, maxBytes);
  return { blob, width, height, mimeType: blob.type, bytes: blob.size };
}

export async function uploadPhoto(
  photo: CapturedPhoto,
  intakeId: string,
  kind: "dashcam" | "instrument-cluster" | "exterior" | "underbody",
): Promise<PhotoUploadResponse> {
  const fd = new FormData();
  fd.set("intakeId", intakeId);
  fd.set("kind", kind);
  fd.set("photo", new File([photo.blob], `${kind}.jpg`, { type: photo.mimeType }));
  const res = await fetch("/api/proxy/intake/photo", { method: "POST", body: fd });
  if (!res.ok) {
    throw new Error(`Photo upload failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as PhotoUploadResponse;
}

function scaleDown(w: number, h: number, maxDim: number): { width: number; height: number } {
  if (w <= maxDim && h <= maxDim) return { width: w, height: h };
  const scale = Math.min(maxDim / w, maxDim / h);
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

async function compress(canvas: HTMLCanvasElement, maxBytes: number): Promise<Blob> {
  // Step down quality until the blob is under the byte cap. JPEG is
  // chosen because the canvas spec guarantees no metadata pass-through.
  for (const q of [0.92, 0.85, 0.78, 0.7, 0.6, 0.5]) {
    const blob = await canvasToBlob(canvas, "image/jpeg", q);
    if (blob && blob.size <= maxBytes) return blob;
  }
  // Last resort: return the smallest produced.
  const fallback = await canvasToBlob(canvas, "image/jpeg", 0.4);
  if (!fallback) throw new Error("Failed to encode photo");
  return fallback;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality));
}
