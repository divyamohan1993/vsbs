// =============================================================================
// Identity Platform tenant abstraction.
//
// VSBS uses a separate Identity Platform tenant per region so that user
// records, session tokens, and audit trails never cross the residency
// boundary. The tenant id is deterministically derived from
//   HMAC-SHA256(secret, region) -> first 20 hex chars
// so the same operator key produces the same tenant id every time without
// requiring an external lookup.
//
// Two drivers ship:
//   - SimDriver: in-memory tenant registry + scripted token verifier; fully
//     deterministic, used by tests and demo mode.
//   - LiveDriver: thin pass-through that points at the Firebase Admin SDK
//     call signatures. Operators wire the real client at deploy time; the
//     interface here is what the rest of the API consumes.
//
// Schema-validated via Zod at every boundary.
// =============================================================================

import { z } from "zod";
import { RegionSchema, type VsbsRegion } from "../middleware/region.js";

export const TenantIdSchema = z
  .string()
  .min(8)
  .max(40)
  .regex(/^[a-z0-9-]+$/, "Tenant ids are lower-hex with optional hyphen");

export type TenantId = z.infer<typeof TenantIdSchema>;

export const IdentityTokenSchema = z.string().min(20);
export type IdentityToken = z.infer<typeof IdentityTokenSchema>;

export const VerifyResultSchema = z.object({
  ok: z.literal(true),
  uid: z.string().min(1),
  tenantId: TenantIdSchema,
  region: RegionSchema,
  expiresAt: z.string().datetime(),
});

export type VerifyOk = z.infer<typeof VerifyResultSchema>;

export type VerifyResult =
  | VerifyOk
  | {
      ok: false;
      error: "BAD_TOKEN" | "WRONG_TENANT" | "EXPIRED" | "WRONG_REGION";
    };

export interface IdentityClient {
  readonly mode: "sim" | "live";
  /** Returns the tenant id for a region, creating one if needed. */
  getOrCreateTenant(region: VsbsRegion): Promise<TenantId>;

  /** Verifies a token issued for a particular tenant. */
  verifyToken(token: IdentityToken, expectedTenant: TenantId): Promise<VerifyResult>;

  /** Mints a custom token for a given uid bound to a tenant. */
  signInWithCustomToken(uid: string, tenant: TenantId): Promise<IdentityToken>;
}

export interface SimIdentityConfig {
  /** HMAC secret used to derive deterministic tenant ids. */
  secret: string;
  /** Token TTL in seconds. */
  tokenTtlSeconds?: number;
  /** Clock injection for tests. */
  now?: () => Date;
}

/** Deterministic tenant id from HMAC-SHA256(secret, region). */
export async function deriveTenantId(secret: string, region: VsbsRegion): Promise<TenantId> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(region)));
  let hex = "";
  for (let i = 0; i < 10; i++) {
    hex += (sig[i] ?? 0).toString(16).padStart(2, "0");
  }
  return TenantIdSchema.parse(`vsbs-${region.replace(/[^a-z0-9]/g, "")}-${hex}`);
}

/** Sim driver — in-memory tenant + token store, deterministic per `secret`. */
export class IdentityPlatformSimDriver implements IdentityClient {
  readonly mode = "sim" as const;
  readonly #tenants = new Map<VsbsRegion, TenantId>();
  readonly #tokens = new Map<
    string,
    { uid: string; tenantId: TenantId; region: VsbsRegion; expiresAt: number }
  >();
  readonly #cfg: Required<SimIdentityConfig>;

  constructor(cfg: SimIdentityConfig) {
    this.#cfg = {
      secret: cfg.secret,
      tokenTtlSeconds: cfg.tokenTtlSeconds ?? 60 * 60,
      now: cfg.now ?? (() => new Date()),
    };
  }

  async getOrCreateTenant(region: VsbsRegion): Promise<TenantId> {
    const cached = this.#tenants.get(region);
    if (cached) return cached;
    const id = await deriveTenantId(this.#cfg.secret, region);
    this.#tenants.set(region, id);
    return id;
  }

  async signInWithCustomToken(uid: string, tenant: TenantId): Promise<IdentityToken> {
    const region = await this.#regionFor(tenant);
    if (!region) {
      throw new Error(`Unknown tenant ${tenant}`);
    }
    const token = `sim.${tenant}.${uid}.${this.#cfg.now().getTime()}.${this.#randomId()}`;
    this.#tokens.set(token, {
      uid,
      tenantId: tenant,
      region,
      expiresAt: this.#cfg.now().getTime() + this.#cfg.tokenTtlSeconds * 1000,
    });
    return IdentityTokenSchema.parse(token);
  }

  async verifyToken(token: IdentityToken, expectedTenant: TenantId): Promise<VerifyResult> {
    const record = this.#tokens.get(token);
    if (!record) return { ok: false, error: "BAD_TOKEN" };
    if (record.tenantId !== expectedTenant) return { ok: false, error: "WRONG_TENANT" };
    if (record.expiresAt <= this.#cfg.now().getTime()) return { ok: false, error: "EXPIRED" };
    return {
      ok: true,
      uid: record.uid,
      tenantId: record.tenantId,
      region: record.region,
      expiresAt: new Date(record.expiresAt).toISOString(),
    };
  }

  async #regionFor(tenant: TenantId): Promise<VsbsRegion | undefined> {
    for (const [region, id] of this.#tenants.entries()) {
      if (id === tenant) return region;
    }
    return undefined;
  }

  #randomId(): string {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    let s = "";
    for (const b of bytes) s += b.toString(16).padStart(2, "0");
    return s;
  }
}

/**
 * Live driver — points at the real Firebase Admin SDK call signatures.
 *
 * The operator wires `firebase-admin/auth` at deploy time; this class is the
 * stable interface the API consumes. The constructor takes the SDK's tenant
 * manager (already configured with credentials) so this file has no Firebase
 * import. That keeps the package import-graph clean and avoids pulling node
 * deps into the Bun-only runtime.
 *
 * Operators are expected to pass an object satisfying the FirebaseTenantClient
 * interface below. In the actual deploy script that is built from the
 * Firebase Admin tenant manager:
 *
 *   import { getAuth } from "firebase-admin/auth";
 *   const auth = getAuth();
 *   const tenantClient: FirebaseTenantClient = {
 *     listTenants: async () => (await auth.tenantManager().listTenants()).tenants,
 *     createTenant: (req) => auth.tenantManager().createTenant(req),
 *     verifyIdToken: (token) => auth.verifyIdToken(token, true),
 *     createCustomToken: (uid, tenantId) =>
 *       auth.tenantManager().authForTenant(tenantId).createCustomToken(uid),
 *   };
 */
export interface FirebaseTenantClient {
  listTenants(): Promise<Array<{ tenantId: string; displayName?: string }>>;
  createTenant(req: { displayName: string }): Promise<{ tenantId: string }>;
  verifyIdToken(
    token: string,
  ): Promise<{ uid: string; firebase: { tenant?: string }; exp: number }>;
  createCustomToken(uid: string, tenantId: string): Promise<string>;
}

export class IdentityPlatformLiveDriver implements IdentityClient {
  readonly mode = "live" as const;
  readonly #client: FirebaseTenantClient;
  readonly #tenants = new Map<VsbsRegion, TenantId>();

  constructor(client: FirebaseTenantClient) {
    this.#client = client;
  }

  async getOrCreateTenant(region: VsbsRegion): Promise<TenantId> {
    const cached = this.#tenants.get(region);
    if (cached) return cached;

    const wanted = `vsbs-${region}`;
    const all = await this.#client.listTenants();
    const found = all.find((t) => t.displayName === wanted || t.tenantId === wanted);
    if (found) {
      const id = TenantIdSchema.parse(found.tenantId.toLowerCase());
      this.#tenants.set(region, id);
      return id;
    }
    const created = await this.#client.createTenant({ displayName: wanted });
    const id = TenantIdSchema.parse(created.tenantId.toLowerCase());
    this.#tenants.set(region, id);
    return id;
  }

  async signInWithCustomToken(uid: string, tenant: TenantId): Promise<IdentityToken> {
    const token = await this.#client.createCustomToken(uid, tenant);
    return IdentityTokenSchema.parse(token);
  }

  async verifyToken(token: IdentityToken, expectedTenant: TenantId): Promise<VerifyResult> {
    try {
      const decoded = await this.#client.verifyIdToken(token);
      if (decoded.firebase.tenant !== expectedTenant) {
        return { ok: false, error: "WRONG_TENANT" };
      }
      const region = await this.#regionFor(expectedTenant);
      if (!region) return { ok: false, error: "WRONG_REGION" };
      const expiresAt = new Date(decoded.exp * 1000);
      if (expiresAt.getTime() <= Date.now()) return { ok: false, error: "EXPIRED" };
      return {
        ok: true,
        uid: decoded.uid,
        tenantId: expectedTenant,
        region,
        expiresAt: expiresAt.toISOString(),
      };
    } catch {
      return { ok: false, error: "BAD_TOKEN" };
    }
  }

  async #regionFor(tenant: TenantId): Promise<VsbsRegion | undefined> {
    for (const [region, id] of this.#tenants.entries()) {
      if (id === tenant) return region;
    }
    return undefined;
  }
}
