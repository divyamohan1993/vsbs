// =============================================================================
// In-memory admin data store. Phase 10 ships the operator console end-to-end
// against a deterministic seed; the same interface swaps to Firestore +
// AlloyDB without any controller change. Every method is O(1) keyed (or
// bounded; the seeded set is small).
// =============================================================================

export type BookingStatus =
  | "accepted"
  | "assigned"
  | "in_progress"
  | "at_bay"
  | "ready"
  | "cancelled"
  | "escalated";

export type DispatchMode = "drive-in" | "valet" | "tow" | "autonomous";
export type SafetyTier = "red" | "amber" | "green";

export interface AdminBooking {
  id: string;
  status: BookingStatus;
  ownerHash: string;
  vehicle: { make: string; model: string; year: number; vin?: string };
  region: "asia-south1" | "us-central1";
  scId: string;
  technicianId: string | null;
  etaMinutes: number;
  dispatchMode: DispatchMode;
  wellbeing: number;
  safetyTier: SafetyTier;
  createdAt: string;
  updatedAt: string;
}

export interface CapacityCell {
  scId: string;
  dayOfWeek: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  hour: number;
  capacity: number;
  utilised: number;
}

export interface RouteEntry {
  routeId: string;
  technicianId: string;
  scId: string;
  pickups: string[];
  currentEtaMinutes: number;
  optimisedEtaMinutes: number;
  lastSolvedAt: string;
}

export interface SlotRow {
  slotId: string;
  scId: string;
  dayOfWeek: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  start: string;
  end: string;
  capacity: number;
  mode: DispatchMode;
}

export interface FairnessRow {
  region: "asia-south1" | "us-central1";
  cohort: string;
  totalBookings: number;
  modeMix: Record<DispatchMode, number>;
  meanWaitMinutes: number;
  p95WaitMinutes: number;
  complaintRate: number;
}

export interface SafetyOverride {
  id: string;
  at: string;
  actor: { kind: "user" | "agent" | "operator"; subject: string };
  bookingId: string;
  decision: "downgrade" | "upgrade" | "tow" | "delay";
  rationale: string;
  context: { signals: string[]; previousTier: SafetyTier; newTier: SafetyTier };
  downstreamEffect: string;
}

export type PricingState = "draft" | "review" | "published";
export interface PricingVersion {
  id: string;
  scId: string;
  version: number;
  state: PricingState;
  effectiveFrom: string;
  parts: Array<{ sku: string; name: string; inr: number }>;
  labour: Array<{ code: string; name: string; minutes: number; inr: number }>;
  createdBy: string;
  createdAt: string;
}

export interface SlaRow {
  scId: string;
  responseMinutes: number;
  resolutionMinutes: number;
  escalationChain: string[];
  burnPct: number;
  updatedAt: string;
}

export interface AuditGrant {
  grantId: string;
  vehicleId: string;
  scId: string;
  ownerId: string;
  tier: "A-AVP" | "B-relocation" | "C-bay-park";
  scopes: string[];
  notBefore: string;
  notAfter: string;
  ownerSignatureB64: string;
  witnessSignaturesB64: Record<string, string>;
  canonicalDigestHex: string;
  merkleIndex: number;
  rootIndex: number;
  status: "minted" | "accepted" | "revoked" | "expired";
}

export interface AuthorityRoot {
  index: number;
  rootHashHex: string;
  size: number;
  publishedAt: string;
}

const SCS = ["sc-blr-01", "sc-blr-02", "sc-pune-01", "sc-sfo-01"] as const;
const TECHS = ["tech-ravi", "tech-priya", "tech-arun", "tech-jen", "tech-marcos"] as const;

function rng(seed: number): () => number {
  // splitmix32 — deterministic so the seeded data set is stable across reloads.
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 16), 0x85ebca6b);
    t = Math.imul(t ^ (t >>> 13), 0xc2b2ae35);
    t = (t ^ (t >>> 16)) >>> 0;
    return t / 0xffffffff;
  };
}

function isoMinusMinutes(min: number): string {
  return new Date(Date.now() - min * 60_000).toISOString();
}
function isoPlusMinutes(min: number): string {
  return new Date(Date.now() + min * 60_000).toISOString();
}

function pickFrom<T>(rand: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rand() * arr.length)] ?? arr[0]!;
}

export class AdminStore {
  readonly bookings = new Map<string, AdminBooking>();
  readonly capacity: CapacityCell[] = [];
  readonly routes = new Map<string, RouteEntry>();
  readonly slots = new Map<string, SlotRow>();
  readonly fairness: FairnessRow[] = [];
  readonly safetyOverrides: SafetyOverride[] = [];
  readonly pricing = new Map<string, PricingVersion[]>();
  readonly sla = new Map<string, SlaRow>();
  readonly grants = new Map<string, AuditGrant>();
  readonly authorityRoots: AuthorityRoot[] = [];
  readonly listeners = new Set<(b: AdminBooking) => void>();

  constructor() {
    this.seed();
  }

  emit(b: AdminBooking): void {
    for (const l of this.listeners) l(b);
  }
  subscribe(fn: (b: AdminBooking) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private seed(): void {
    const rand = rng(0xc0ffee);

    for (let i = 0; i < 64; i++) {
      const id = `bk_${(i + 1).toString().padStart(5, "0")}`;
      const status = pickFrom(
        rand,
        ["accepted", "assigned", "in_progress", "at_bay", "ready"] as const,
      );
      const region = rand() > 0.7 ? "us-central1" : "asia-south1";
      const sc = pickFrom(rand, region === "us-central1" ? ["sc-sfo-01"] : SCS.slice(0, 3));
      const tier = rand() > 0.92 ? "red" : rand() > 0.7 ? "amber" : "green";
      const dispatch = pickFrom(rand, ["drive-in", "valet", "tow", "autonomous"] as const);
      const tech = pickFrom(rand, TECHS);
      const createdAt = isoMinusMinutes(Math.floor(rand() * 360));
      this.bookings.set(id, {
        id,
        status,
        ownerHash: `h${Math.floor(rand() * 0xffffffff).toString(16)}`,
        vehicle: pickFrom(rand, [
          { make: "Honda", model: "Civic", year: 2024 },
          { make: "Tata", model: "Nexon EV", year: 2025 },
          { make: "Mahindra", model: "XUV700", year: 2023 },
          { make: "Hyundai", model: "Creta", year: 2024 },
          { make: "Mercedes", model: "EQS", year: 2026 },
        ]),
        region,
        scId: sc,
        technicianId: status === "accepted" ? null : tech,
        etaMinutes: Math.floor(rand() * 90) + 5,
        dispatchMode: dispatch,
        wellbeing: 0.6 + rand() * 0.35,
        safetyTier: tier,
        createdAt,
        updatedAt: createdAt,
      });
    }

    for (const sc of SCS) {
      for (let day = 0; day < 7; day++) {
        for (let hour = 7; hour < 22; hour++) {
          const cap = sc === "sc-sfo-01" ? 4 : 6;
          const base = Math.sin((hour - 7) / 2) * 0.4 + 0.5;
          const utilised = Math.max(0, Math.min(cap, Math.round((base + rand() * 0.3) * cap)));
          this.capacity.push({
            scId: sc,
            dayOfWeek: day as 0 | 1 | 2 | 3 | 4 | 5 | 6,
            hour,
            capacity: cap,
            utilised,
          });
        }
      }
    }

    for (let i = 0; i < 12; i++) {
      const id = `rt_${(i + 1).toString().padStart(4, "0")}`;
      const tech = pickFrom(rand, TECHS);
      const sc = pickFrom(rand, SCS);
      const current = Math.floor(rand() * 50) + 10;
      this.routes.set(id, {
        routeId: id,
        technicianId: tech,
        scId: sc,
        pickups: Array.from({ length: 1 + Math.floor(rand() * 3) }).map(
          () => `bk_${(Math.floor(rand() * 64) + 1).toString().padStart(5, "0")}`,
        ),
        currentEtaMinutes: current,
        optimisedEtaMinutes: Math.max(5, current - Math.floor(rand() * 8)),
        lastSolvedAt: isoMinusMinutes(Math.floor(rand() * 30)),
      });
    }

    for (const sc of SCS) {
      for (let day = 0; day < 7; day++) {
        const id = `slot_${sc}_${day}_morning`;
        this.slots.set(id, {
          slotId: id,
          scId: sc,
          dayOfWeek: day as 0 | 1 | 2 | 3 | 4 | 5 | 6,
          start: "08:00",
          end: "12:00",
          capacity: 6,
          mode: "drive-in",
        });
        const idA = `slot_${sc}_${day}_afternoon`;
        this.slots.set(idA, {
          slotId: idA,
          scId: sc,
          dayOfWeek: day as 0 | 1 | 2 | 3 | 4 | 5 | 6,
          start: "13:00",
          end: "18:00",
          capacity: 6,
          mode: "valet",
        });
      }
    }

    const cohorts = ["urban-core", "suburban", "tier-2"] as const;
    for (const region of ["asia-south1", "us-central1"] as const) {
      for (const cohort of cohorts) {
        const total = 100 + Math.floor(rand() * 200);
        const modeMix: Record<DispatchMode, number> = {
          "drive-in": 0,
          valet: 0,
          tow: 0,
          autonomous: 0,
        };
        for (let i = 0; i < total; i++) {
          const m = pickFrom(rand, ["drive-in", "valet", "tow", "autonomous"] as const);
          modeMix[m] += 1;
        }
        this.fairness.push({
          region,
          cohort,
          totalBookings: total,
          modeMix,
          meanWaitMinutes: Math.round(20 + rand() * 30),
          p95WaitMinutes: Math.round(50 + rand() * 60),
          complaintRate: Math.round(rand() * 50) / 1000,
        });
      }
    }

    for (let i = 0; i < 18; i++) {
      const id = `so_${(i + 1).toString().padStart(4, "0")}`;
      const tier: SafetyTier = pickFrom(rand, ["red", "amber", "green"]);
      const newTier: SafetyTier = pickFrom(
        rand,
        tier === "red" ? ["amber", "green"] : tier === "amber" ? ["red", "green"] : ["amber", "red"],
      );
      this.safetyOverrides.push({
        id,
        at: isoMinusMinutes(Math.floor(rand() * 1440)),
        actor: pickFrom(rand, [
          { kind: "user", subject: `h${Math.floor(rand() * 0xffff).toString(16)}` },
          { kind: "agent", subject: "supervisor-claude-opus-4-6" },
          { kind: "operator", subject: "ops.dmj@vsbs.in" },
        ]),
        bookingId: `bk_${(Math.floor(rand() * 64) + 1).toString().padStart(5, "0")}`,
        decision: pickFrom(rand, ["downgrade", "upgrade", "tow", "delay"] as const),
        rationale: pickFrom(rand, [
          "Owner reports brake squeal but car drives straight; reduced from red to amber after PHM agreed.",
          "Sensor flagged ABS warning, escalated to red and tow dispatched.",
          "Repeat customer history; escalated to operator review.",
          "Auto-downgrade after second confirming check.",
        ]),
        context: {
          signals: pickFrom(rand, [
            ["abs", "wheel-speed-asymm"],
            ["brake-pad-low", "vibration"],
            ["tpms"],
            ["dtc-p0301"],
          ]),
          previousTier: tier,
          newTier,
        },
        downstreamEffect: pickFrom(rand, [
          "Tow dispatched within 8 minutes.",
          "ETA extended by 12 minutes; customer notified.",
          "No customer-facing change; logged for QA.",
          "Booking re-routed to specialist bay.",
        ]),
      });
    }

    for (const sc of SCS) {
      const versions: PricingVersion[] = [];
      for (let v = 1; v <= 3; v++) {
        const state: PricingState = v === 3 ? "draft" : v === 2 ? "review" : "published";
        versions.push({
          id: `pv_${sc}_${v}`,
          scId: sc,
          version: v,
          state,
          effectiveFrom: isoMinusMinutes(Math.floor((4 - v) * 1440)),
          parts: [
            { sku: "BRK-PAD-FR", name: "Front brake pad set", inr: 2400 + v * 50 },
            { sku: "OIL-5W30-4L", name: "Engine oil 5W30 (4L)", inr: 1800 + v * 30 },
            { sku: "AIRFLT-A1", name: "Cabin air filter", inr: 600 },
          ],
          labour: [
            { code: "L-OIL", name: "Oil & filter change", minutes: 30, inr: 500 },
            { code: "L-BRK", name: "Brake pad replace", minutes: 60, inr: 900 },
          ],
          createdBy: "ops.dmj@vsbs.in",
          createdAt: isoMinusMinutes(Math.floor((4 - v) * 1440)),
        });
      }
      this.pricing.set(sc, versions);
    }

    for (const sc of SCS) {
      this.sla.set(sc, {
        scId: sc,
        responseMinutes: 15,
        resolutionMinutes: 240,
        escalationChain: ["ops.dmj@vsbs.in", "regional.lead@vsbs.in", "incident.cmdr@vsbs.in"],
        burnPct: Math.round(rand() * 80),
        updatedAt: isoMinusMinutes(60),
      });
    }

    for (let i = 0; i < 12; i++) {
      const id = `gr_${(i + 1).toString().padStart(5, "0")}`;
      const status: AuditGrant["status"] = pickFrom(
        rand,
        ["minted", "accepted", "revoked", "expired"] as const,
      );
      this.grants.set(id, {
        grantId: id,
        vehicleId: `veh_${Math.floor(rand() * 0xffff).toString(16)}`,
        scId: pickFrom(rand, SCS),
        ownerId: `own_${Math.floor(rand() * 0xffff).toString(16)}`,
        tier: pickFrom(rand, ["A-AVP", "B-relocation", "C-bay-park"] as const),
        scopes: pickFrom(rand, [
          ["park", "stop"],
          ["relocate-bay", "stop", "park"],
          ["self-drive-park", "stop", "report"],
        ]),
        notBefore: isoMinusMinutes(Math.floor(rand() * 60)),
        notAfter: isoPlusMinutes(20 + Math.floor(rand() * 90)),
        ownerSignatureB64: btoa(
          String.fromCharCode(...Array.from({ length: 64 }, () => Math.floor(rand() * 255))),
        ),
        witnessSignaturesB64: {
          "vsbs-witness-asia-south1": btoa(
            String.fromCharCode(...Array.from({ length: 64 }, () => Math.floor(rand() * 255))),
          ),
        },
        canonicalDigestHex: Array.from({ length: 32 }, () =>
          Math.floor(rand() * 255).toString(16).padStart(2, "0"),
        ).join(""),
        merkleIndex: i,
        rootIndex: Math.floor(i / 4),
        status,
      });
    }

    for (let r = 0; r < 4; r++) {
      this.authorityRoots.push({
        index: r,
        rootHashHex: Array.from({ length: 32 }, () =>
          Math.floor(rand() * 255).toString(16).padStart(2, "0"),
        ).join(""),
        size: (r + 1) * 4,
        publishedAt: isoMinusMinutes((4 - r) * 1440),
      });
    }
  }
}

let singleton: AdminStore | null = null;
export function getAdminStore(): AdminStore {
  if (!singleton) singleton = new AdminStore();
  return singleton;
}
