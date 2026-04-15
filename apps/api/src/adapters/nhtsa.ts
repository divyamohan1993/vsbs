// NHTSA vPIC adapter — free, no key. Cached for 30 days (NHTSA throttles
// aggressive querying; reference: docs/research/automotive.md §1).
//
// This is a real adapter: it calls the real endpoint. Use the
// `fetchImpl` injection point for tests and for the edge-cache layer.

import { z } from "zod";

// DecodeVinValues returns a single-row response where each vehicle
// variable is a top-level property on Results[0], e.g. { Make: "HONDA",
// Model: "Odyssey", ModelYear: "2003", ... }. This is different from
// `DecodeVin` which returns Variable/Value pairs.
// Reference: https://vpic.nhtsa.dot.gov/api/
const DecodeResultSchema = z.object({
  Count: z.number(),
  Message: z.string(),
  SearchCriteria: z.string().nullable(),
  Results: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.null()]))).default([]),
});

export interface DecodedVin {
  vin: string;
  make: string | null;
  model: string | null;
  modelYear: string | null;
  bodyClass: string | null;
  fuelType: string | null;
  driveType: string | null;
  engineCylinders: string | null;
  gvwr: string | null;
  plantCountry: string | null;
  raw: Record<string, string | null>;
}

export interface NhtsaClientConfig {
  base: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export function makeNhtsaClient(cfg: NhtsaClientConfig) {
  const base = cfg.base.replace(/\/+$/, "");
  const fetchImpl = cfg.fetchImpl ?? fetch;
  const timeoutMs = cfg.timeoutMs ?? 5000;

  return {
    async decodeVin(vin: string, modelYear?: number): Promise<DecodedVin> {
      const path = `/DecodeVinValues/${encodeURIComponent(vin)}?format=json${
        modelYear !== undefined ? `&modelyear=${modelYear}` : ""
      }`;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      let res: Response;
      try {
        res = await fetchImpl(`${base}${path}`, { signal: ctrl.signal });
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) {
        throw new Error(`NHTSA vPIC error ${res.status} for ${vin}`);
      }
      const json = (await res.json()) as unknown;
      const parsed = DecodeResultSchema.parse(json);
      const row = parsed.Results[0];
      if (!row) {
        throw new Error(`NHTSA vPIC returned no results for ${vin}`);
      }
      // Normalise every value to string|null so downstream can rely on
      // a uniform shape regardless of whether NHTSA returns ""/null/number.
      const raw: Record<string, string | null> = {};
      for (const [k, v] of Object.entries(row)) {
        raw[k] = v === null || v === "" ? null : String(v);
      }
      return {
        vin,
        make: raw.Make ?? null,
        model: raw.Model ?? null,
        modelYear: raw.ModelYear ?? null,
        bodyClass: raw.BodyClass ?? null,
        fuelType: raw.FuelTypePrimary ?? null,
        driveType: raw.DriveType ?? null,
        engineCylinders: raw.EngineCylinders ?? null,
        gvwr: raw.GVWR ?? null,
        plantCountry: raw.PlantCountry ?? null,
        raw,
      };
    },
  };
}
