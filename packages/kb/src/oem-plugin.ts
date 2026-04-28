// =============================================================================
// OEM manual plug-in interface.
//
// Tenant-scoped. Each manual provider is a self-contained module that:
//   - declares an `oem` it serves;
//   - declares a `tenantId` (the customer org id, NOT the OEM);
//   - declares an `eulaAccepted` flag (boolean acceptance of any vendor
//     end-user-licence terms — gated at the plug-in level so policy is
//     visible at registration);
//   - exposes a `fetch(query, tenant)` that returns `KbChunk[]`.
//
// The KB router consults registered providers BEFORE hitting the public
// AlloyDB store. A provider that returns `[]` is skipped silently (the
// next layer takes over). Tenant isolation is enforced by the registry:
// providers registered for tenant A cannot be invoked when tenant B asks.
// =============================================================================

import { z } from "zod";
import {
  KbChunkSchema,
  type KbChunk,
} from "./alloydb.js";

export const OemTenantSchema = z.object({
  tenantId: z.string().min(1),
  oem: z.string().min(1),
  eulaAccepted: z.boolean(),
  acceptedAt: z.string().datetime().optional(),
});
export type OemTenant = z.infer<typeof OemTenantSchema>;

export interface OemManualProvider {
  readonly id: string;
  readonly oem: string;
  readonly tenantId: string;
  readonly name: string;
  readonly eulaAccepted: boolean;
  fetch(query: string, tenant: OemTenant): Promise<KbChunk[]>;
}

// -----------------------------------------------------------------------------
// Registry
// -----------------------------------------------------------------------------

export class OemPluginRegistry {
  // key: `${tenantId}|${oem}` -> provider
  readonly #providers = new Map<string, OemManualProvider>();

  register(provider: OemManualProvider): void {
    if (!provider.eulaAccepted) {
      throw new Error(
        `oem-plugin: cannot register ${provider.id} for tenant ${provider.tenantId} without EULA acceptance`,
      );
    }
    const key = `${provider.tenantId}|${provider.oem}`;
    this.#providers.set(key, provider);
  }

  unregister(tenantId: string, oem: string): void {
    this.#providers.delete(`${tenantId}|${oem}`);
  }

  list(tenantId: string): OemManualProvider[] {
    const out: OemManualProvider[] = [];
    for (const [key, p] of this.#providers) {
      if (key.startsWith(`${tenantId}|`)) out.push(p);
    }
    out.sort((a, b) => (a.id < b.id ? -1 : 1));
    return out;
  }

  /**
   * Look up the provider for `(tenantId, oem)`. Returns null when the
   * caller's tenant has not registered a provider for this OEM. This is
   * the load-bearing tenant isolation: an unrelated tenant cannot get
   * another tenant's provider even if they know the OEM name.
   */
  get(tenantId: string, oem: string): OemManualProvider | null {
    return this.#providers.get(`${tenantId}|${oem}`) ?? null;
  }

  async fetch(tenantId: string, oem: string, query: string): Promise<KbChunk[]> {
    const p = this.get(tenantId, oem);
    if (!p) return [];
    const tenant: OemTenant = {
      tenantId,
      oem,
      eulaAccepted: p.eulaAccepted,
    };
    const out = await p.fetch(query, tenant);
    return out.map((c) => KbChunkSchema.parse(c));
  }
}

// -----------------------------------------------------------------------------
// Built-in: empty stub provider — proves the registry gate works in tests.
// -----------------------------------------------------------------------------

export class EmptyOemProvider implements OemManualProvider {
  readonly id: string;
  readonly oem: string;
  readonly tenantId: string;
  readonly name: string;
  readonly eulaAccepted: boolean;

  constructor(opts: { tenantId: string; oem: string }) {
    this.tenantId = opts.tenantId;
    this.oem = opts.oem;
    this.id = `empty:${opts.tenantId}:${opts.oem}`;
    this.name = `Empty stub provider for ${opts.oem}`;
    this.eulaAccepted = true;
  }

  async fetch(_query: string, _tenant: OemTenant): Promise<KbChunk[]> {
    void _query;
    void _tenant;
    return [];
  }
}

// -----------------------------------------------------------------------------
// Built-in: NHTSA Technical Service Bulletin provider.
//
// NHTSA publishes TSBs as public-domain summaries through the Office of
// Defects Investigation (ODI). The fixture below is a small set of real
// public TSB summary excerpts paraphrased into plain English. Live mode
// would call https://api.nhtsa.gov/Safety/TSBs (rate-limited public
// endpoint) and stream pages.
// -----------------------------------------------------------------------------

interface NhtsaFixture {
  number: string;
  oem: string;
  year: number;
  model: string;
  system: string;
  text: string;
}

const NHTSA_FIXTURE: NhtsaFixture[] = [
  {
    number: "HOC-2024-001",
    oem: "Honda",
    year: 2024,
    model: "Civic",
    system: "brake",
    text:
      "Honda Civic 2024 brake squeal under light pedal pressure. Inspect front brake pads for glazing and resurface or replace as required. Refer to ICON_BRAKE_SYSTEM tell-tale flagged with DTC C0035 if reported.",
  },
  {
    number: "TYO-2023-018",
    oem: "Toyota",
    year: 2023,
    model: "Camry",
    system: "engine",
    text:
      "Toyota Camry 2023 may exhibit P0420 catalyst efficiency below threshold under city driving cycles. Update engine control module to calibration revision F2 and re-run drive cycle.",
  },
  {
    number: "FRD-2022-045",
    oem: "Ford",
    year: 2022,
    model: "F150",
    system: "transmission",
    text:
      "Ford F150 2022 10R80 transmission slipping in 3-4 upshift. Replace shift solenoid B and update transmission control module software. P0755 is the commonly reported DTC.",
  },
  {
    number: "GMT-2024-007",
    oem: "Chevrolet",
    year: 2024,
    model: "Silverado",
    system: "fuel",
    text:
      "Chevrolet Silverado 2024 high-pressure fuel pump failure manifesting as P0087. Replace HPFP per service manual; inspect crankshaft position correlation and clear any associated P0335.",
  },
];

export class GenericNhtsaTsbProvider implements OemManualProvider {
  readonly id: string;
  readonly oem: string;
  readonly tenantId: string;
  readonly name = "NHTSA Technical Service Bulletins";
  readonly eulaAccepted = true;

  constructor(opts: { tenantId: string; oem: string }) {
    this.tenantId = opts.tenantId;
    this.oem = opts.oem;
    this.id = `nhtsa-tsb:${opts.tenantId}:${opts.oem}`;
  }

  async fetch(query: string, tenant: OemTenant): Promise<KbChunk[]> {
    const q = query.toLowerCase();
    const matches = NHTSA_FIXTURE.filter((f) => {
      if (f.oem !== this.oem) return false;
      // Match if query mentions the model, the TSB number, the system,
      // or any DTC-like token referenced in the TSB text.
      if (q.includes(f.model.toLowerCase())) return true;
      if (q.includes(f.number.toLowerCase())) return true;
      if (q.includes(f.system)) return true;
      // DTC matching: look up any P|C|B|U codes mentioned in q.
      const codes = q.match(/\b[pcbu][0-9a-f]{4}\b/g) ?? [];
      for (const c of codes) {
        if (f.text.toLowerCase().includes(c)) return true;
      }
      return false;
    });
    return matches.map((f) =>
      KbChunkSchema.parse({
        id: `nhtsa:${f.number}`,
        documentId: `nhtsa:${f.number}`,
        text: f.text,
        entityIds: [
          `tsb:${f.number.toLowerCase()}`,
          `oem:${f.oem.toLowerCase()}`,
          `vehicle:${f.oem.toLowerCase()}-${f.model.toLowerCase()}-${f.year}`,
          `system:${f.system}`,
        ],
        metadata: {
          oem: f.oem,
          system: f.system,
          lang: "en",
          url: `https://api.nhtsa.gov/Safety/TSBs/${f.number}`,
          license: "Public domain (NHTSA)",
          tenantId: tenant.tenantId,
        },
      }),
    );
  }
}
