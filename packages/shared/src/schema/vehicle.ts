import { z } from "zod";

/**
 * ISO 3779 VIN — 17 characters, no I/O/Q. We also apply the ISO 3779
 * check-digit (position 9) validation.
 *
 * The NHTSA vPIC API ultimately decides if the VIN is decodable, but we
 * reject obvious nonsense on the client to save a round-trip.
 * See docs/research/automotive.md §1.
 */
const VIN_ALPHABET = /^[A-HJ-NPR-Z0-9]{17}$/;
const VIN_TRANSLIT: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
  "0": 0, "1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9,
};
const VIN_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

export function vinCheckDigitValid(vin: string): boolean {
  if (!VIN_ALPHABET.test(vin)) return false;
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const ch = vin[i];
    if (ch === undefined) return false;
    const v = VIN_TRANSLIT[ch];
    const w = VIN_WEIGHTS[i];
    if (v === undefined || w === undefined) return false;
    sum += v * w;
  }
  const expected = sum % 11;
  const expectedChar = expected === 10 ? "X" : String(expected);
  return vin[8] === expectedChar;
}

export const VinSchema = z
  .string()
  .length(17)
  .transform((s) => s.toUpperCase())
  .refine(vinCheckDigitValid, { message: "Invalid VIN check digit (ISO 3779)" });

/**
 * Indian RC plate — {State}{District}{Series}{Number} permissive pattern.
 * Order matters: strip whitespace + uppercase BEFORE the length check so
 * user-friendly formats like "DL 1C AB 1234" or "dl 1c ab 1234" normalise
 * to "DL1CAB1234" (10 chars) and pass the 6..12 length bound.
 */
export const IndiaPlateSchema = z
  .string()
  .transform((s) => s.toUpperCase().replace(/\s+/g, ""))
  .pipe(
    z
      .string()
      .min(6)
      .max(12)
      .refine((s) => /^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{1,4}$/.test(s), {
        message: "Not a recognised Indian plate pattern",
      }),
  );

export const FuelTypeSchema = z.enum([
  "petrol",
  "diesel",
  "cng",
  "lpg",
  "ev",
  "phev",
  "hev",
  "hydrogen",
  "other",
]);

export const TransmissionSchema = z.enum([
  "manual",
  "automatic",
  "amt",
  "cvt",
  "dct",
  "ev-single-speed",
]);

export const DriveTypeSchema = z.enum(["fwd", "rwd", "awd", "4wd"]);

/**
 * Base object schema, partial-able. `VehicleIdentitySchema` below adds
 * the cross-field refinement for the committed form.
 */
export const VehicleIdentityBaseSchema = z.object({
  vin: VinSchema.optional(),
  indiaPlate: IndiaPlateSchema.optional(),
  indiaPlateStateCode: z.string().length(2).toUpperCase().optional(),
  make: z.string().min(1).max(40),
  model: z.string().min(1).max(80),
  trim: z.string().max(80).optional(),
  year: z.number().int().min(1950).max(new Date().getFullYear() + 1),
  fuel: FuelTypeSchema,
  transmission: TransmissionSchema,
  driveType: DriveTypeSchema.optional(),
  engineDisplacementCc: z.number().int().min(50).max(10_000).optional(),
  batteryKwh: z.number().positive().max(500).optional(),
  odometerKm: z.number().int().min(0).max(5_000_000),
  colour: z.string().max(30).optional(),
  purchaseDate: z.string().date().optional(),
  warrantyExpiry: z.string().date().optional(),
  insuranceProvider: z.string().max(80).optional(),
  insurancePolicyExpiry: z.string().date().optional(),
  fastagId: z.string().max(20).optional(),
  modifications: z.array(z.string().max(120)).max(20).default([]),
});

export const VehicleIdentitySchema = VehicleIdentityBaseSchema.refine(
  (v) => v.vin !== undefined || v.indiaPlate !== undefined,
  {
    message: "Either VIN or Indian registration plate is required",
    path: ["vin"],
  },
);

export type VehicleIdentity = z.infer<typeof VehicleIdentitySchema>;

export const ServiceHistoryEntrySchema = z.object({
  date: z.string().date(),
  odometerKm: z.number().int().min(0),
  kind: z.enum([
    "routine",
    "repair",
    "recall",
    "accident",
    "inspection",
    "software-update",
  ]),
  provider: z.string().max(120).optional(),
  partsReplaced: z.array(z.string().max(120)).max(50).default([]),
  costInr: z.number().nonnegative().optional(),
  notes: z.string().max(1000).optional(),
});
export type ServiceHistoryEntry = z.infer<typeof ServiceHistoryEntrySchema>;

export const ServiceHistorySchema = z.object({
  lastServiceDate: z.string().date().optional(),
  lastServiceOdometerKm: z.number().int().min(0).optional(),
  lastOilBrand: z.string().max(80).optional(),
  lastOilType: z.string().max(40).optional(),
  brakePadLifePercent: z.number().min(0).max(100).optional(),
  tireDotCodes: z.array(z.string().max(20)).max(8).default([]),
  tireBrand: z.string().max(80).optional(),
  tireSize: z.string().max(40).optional(),
  batteryInstallDate: z.string().date().optional(),
  openRecalls: z.array(z.string().max(120)).default([]),
  history: z.array(ServiceHistoryEntrySchema).max(200).default([]),
});
export type ServiceHistory = z.infer<typeof ServiceHistorySchema>;
