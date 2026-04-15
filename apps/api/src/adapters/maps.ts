// Google Maps Platform adapter — Routes API v2 (computeRoutes).
//
// The real endpoint:
//   POST https://routes.googleapis.com/directions/v2:computeRoutes
//     Headers: X-Goog-Api-Key, X-Goog-FieldMask
// See docs/research/dispatch.md §1.

import { z } from "zod";

const ComputeRoutesResponseSchema = z.object({
  routes: z
    .array(
      z.object({
        distanceMeters: z.number(),
        duration: z.string(),
        staticDuration: z.string().optional(),
        polyline: z
          .object({ encodedPolyline: z.string() })
          .optional(),
      }),
    )
    .default([]),
});

export interface RoutesClientConfig {
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface LatLng { lat: number; lng: number }

export function makeRoutesClient(cfg: RoutesClientConfig) {
  const fetchImpl = cfg.fetchImpl ?? fetch;
  const timeoutMs = cfg.timeoutMs ?? 5000;

  return {
    async driveEta(origin: LatLng, dest: LatLng): Promise<{ distanceMeters: number; durationSeconds: number }> {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetchImpl("https://routes.googleapis.com/directions/v2:computeRoutes", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": cfg.apiKey,
            "X-Goog-FieldMask": "routes.distanceMeters,routes.duration",
          },
          body: JSON.stringify({
            origin: { location: { latLng: origin } },
            destination: { location: { latLng: dest } },
            travelMode: "DRIVE",
            routingPreference: "TRAFFIC_AWARE",
          }),
          signal: ctrl.signal,
        });
        if (!res.ok) {
          throw new Error(`Routes API error ${res.status}`);
        }
        const json = (await res.json()) as unknown;
        const parsed = ComputeRoutesResponseSchema.parse(json);
        const r = parsed.routes[0];
        if (!r) throw new Error("Routes API returned zero routes");
        // `duration` arrives as "1234s"
        const durationSeconds = Number.parseInt(r.duration.replace(/s$/, ""), 10);
        return { distanceMeters: r.distanceMeters, durationSeconds };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
