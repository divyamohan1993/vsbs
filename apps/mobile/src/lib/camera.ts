// =============================================================================
// Camera + photo upload pipeline.
//
// We use expo-camera for live capture (instrument cluster, dashcam, visible
// damage). Each captured frame:
//
//   1. Strips EXIF metadata (`exif: false` on the camera options) so that
//      GPS / device serials never leak.
//   2. Reads the file with expo-file-system (we accept the URI string from
//      expo-camera; FileSystem reads it as a blob without going through
//      the JS bridge as base64 unless asked).
//   3. POSTs the blob as multipart/form-data to /v1/intake/photo.
//
// PII rule: the only metadata we send is the booking id and the user-
// provided "kind" tag (e.g. "instrument-cluster"). No timestamp from the
// device clock, no location.
// =============================================================================

import { CameraView, type CameraCapturedPicture } from "expo-camera";
import { resolveBaseUrl } from "./region";
import * as SecureStore from "expo-secure-store";

export type PhotoKind = "instrument-cluster" | "warning-light" | "exterior-damage" | "interior" | "other";

export async function capturePhoto(camera: CameraView): Promise<CameraCapturedPicture> {
  const result = await camera.takePictureAsync({
    quality: 0.85,
    exif: false,
    skipProcessing: false,
    imageType: "jpg",
  });
  if (!result) throw new Error("Camera returned no image");
  return result;
}

export async function uploadPhoto(opts: {
  photo: CameraCapturedPicture;
  kind: PhotoKind;
  bookingId?: string;
}): Promise<{ url: string }> {
  const base = await resolveBaseUrl();
  const form = new FormData();
  // RN multipart shape: { uri, name, type } per FormData.append docs.
  form.append(
    "file",
    {
      uri: opts.photo.uri,
      name: `${opts.kind}.jpg`,
      type: "image/jpeg",
      // RN extends standard FormData; the unknown cast is the documented escape hatch.
    } as unknown as Blob,
  );
  form.append("kind", opts.kind);
  if (opts.bookingId) form.append("bookingId", opts.bookingId);

  const headers: Record<string, string> = {};
  const token = await SecureStore.getItemAsync("vsbs.session.token");
  if (token) headers["authorization"] = `Bearer ${token}`;

  const res = await fetch(`${base}/v1/intake/photo`, {
    method: "POST",
    headers,
    body: form as unknown as BodyInit,
  });
  if (!res.ok) throw new Error(`Photo upload failed: HTTP ${res.status}`);
  const json: unknown = await res.json();
  if (
    typeof json !== "object" ||
    json === null ||
    !("data" in json) ||
    typeof (json as { data: unknown }).data !== "object"
  ) {
    throw new Error("Photo upload: malformed response");
  }
  const data = (json as { data: { url?: unknown } }).data;
  if (typeof data.url !== "string") throw new Error("Photo upload: missing url");
  return { url: data.url };
}
