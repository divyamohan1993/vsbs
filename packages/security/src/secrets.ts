// =============================================================================
// Secret rotation — Secret Manager + KMS. 30-day enforcement.
//
// References:
//   docs/research/security.md §5 (Secret Manager + KMS auto-rotate, 30 d)
//   docs/research/security.md §7 (asset table)
//
// Sim driver maintains a versioned ring (current, previous, n-2) keyed by
// secretId. Each rotation appends a new version, archives the previous,
// and trims the ring at length 3. Live driver delegates to the GCP Secret
// Manager API and falls back through identical state.
//
// All secrets are produced by deterministic-shape generators. The defaults
// are: 32-byte HTTP auth secret, 32-byte webhook signing secret, 24-char
// database password from the safe printable set. Callers can register
// custom generators with their own length/charset.
// =============================================================================

import { z } from "zod";

export const SECRET_ROTATION_DEFAULT_DAYS = 30;
const MS_PER_DAY = 24 * 3600 * 1000;
export const SAFE_PASSWORD_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";

export const SecretVersionSchema = z.object({
  secretId: z.string().min(1),
  version: z.number().int().positive(),
  value: z.string().min(1),
  createdAt: z.string().datetime(),
  enabled: z.boolean(),
});
export type SecretVersion = z.infer<typeof SecretVersionSchema>;

export interface SecretGenerator {
  (): string;
}

export interface SecretRotator {
  readonly mode: "sim" | "live";
  /** Register or replace a rotator for `secretId`. Idempotent. */
  register(secretId: string, generator: SecretGenerator): void;
  /** Force a rotation now. Returns the freshly minted version. */
  rotateSecret(secretId: string, generator?: SecretGenerator): SecretVersion;
  /** Latest enabled version for `secretId`, or null. */
  current(secretId: string): SecretVersion | null;
  /** All versions for `secretId`, newest first. */
  versions(secretId: string): SecretVersion[];
  /** Returns ids whose lastRotated exceeds the threshold. O(n) on registered. */
  due(now?: Date): string[];
  /** Sweep: rotate every secret that is past due. Returns ids rotated. */
  sweep(now?: Date): string[];
  /** Disable a specific version (manual incident response). */
  disable(secretId: string, version: number): void;
}

export interface SecretRotatorOptions {
  ringSize?: number;
  rotationDays?: number;
}

interface RegisteredSecret {
  generator: SecretGenerator;
  versions: SecretVersion[];
}

export function makeSimSecretRotator(opts: SecretRotatorOptions = {}): SecretRotator {
  const ringSize = opts.ringSize ?? 3;
  const rotationDays = opts.rotationDays ?? SECRET_ROTATION_DEFAULT_DAYS;
  const registry = new Map<string, RegisteredSecret>();

  function nextVersion(rec: RegisteredSecret): number {
    const top = rec.versions[0];
    return top ? top.version + 1 : 1;
  }

  function trim(rec: RegisteredSecret): void {
    if (rec.versions.length <= ringSize) return;
    rec.versions = rec.versions.slice(0, ringSize);
  }

  return {
    mode: "sim",
    register(secretId: string, generator: SecretGenerator): void {
      const existing = registry.get(secretId);
      if (existing) {
        existing.generator = generator;
        return;
      }
      registry.set(secretId, { generator, versions: [] });
    },
    rotateSecret(secretId: string, generator?: SecretGenerator): SecretVersion {
      const rec = registry.get(secretId);
      if (!rec && !generator) {
        throw new Error(`unknown secret ${secretId}; pass a generator or register first`);
      }
      const useGen = generator ?? rec!.generator;
      const target = rec ?? { generator: useGen, versions: [] };
      if (!rec) registry.set(secretId, target);
      target.generator = useGen;
      const version = nextVersion(target);
      const value = useGen();
      const fresh: SecretVersion = SecretVersionSchema.parse({
        secretId,
        version,
        value,
        createdAt: new Date().toISOString(),
        enabled: true,
      });
      target.versions.unshift(fresh);
      trim(target);
      return fresh;
    },
    current(secretId: string): SecretVersion | null {
      const rec = registry.get(secretId);
      if (!rec) return null;
      for (const v of rec.versions) if (v.enabled) return v;
      return null;
    },
    versions(secretId: string): SecretVersion[] {
      const rec = registry.get(secretId);
      return rec ? [...rec.versions] : [];
    },
    due(now: Date = new Date()): string[] {
      const cutoff = now.getTime() - rotationDays * MS_PER_DAY;
      const ids: string[] = [];
      for (const [id, rec] of registry.entries()) {
        const head = rec.versions[0];
        if (!head) {
          ids.push(id);
          continue;
        }
        const created = Date.parse(head.createdAt);
        if (Number.isFinite(created) && created < cutoff) ids.push(id);
      }
      return ids;
    },
    sweep(now: Date = new Date()): string[] {
      const ids = this.due(now);
      const rotated: string[] = [];
      for (const id of ids) {
        try {
          this.rotateSecret(id);
          rotated.push(id);
        } catch {
          // skip — caller decides recovery (paged via observability)
        }
      }
      return rotated;
    },
    disable(secretId: string, version: number): void {
      const rec = registry.get(secretId);
      if (!rec) return;
      for (const v of rec.versions) {
        if (v.version === version) v.enabled = false;
      }
    },
  };
}

// -----------------------------------------------------------------------------
// Built-in generators
// -----------------------------------------------------------------------------

function randomBytesB64(n: number): string {
  const buf = crypto.getRandomValues(new Uint8Array(n));
  let s = "";
  for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]!);
  return btoa(s).replace(/=+$/, "");
}

/** 256-bit HTTP auth secret encoded as base64 (no padding). */
export function httpAuthSecret(): string {
  return randomBytesB64(32);
}

/** 256-bit webhook signing secret (HMAC-SHA-256 key). */
export function webhookSigningSecret(): string {
  return randomBytesB64(32);
}

/**
 * 24-char password drawn from the safe set (`[A-Za-z0-9!@#$%^&*]`). Uses
 * rejection sampling so the modulo bias is zero across the alphabet — for a
 * 256-byte source uniform across [0, 256), only the first
 * `floor(256 / |alphabet|) * |alphabet|` byte values are accepted.
 */
export function databasePassword(length = 24): string {
  if (length <= 0 || length > 1024) throw new Error("password length out of range");
  const alphabet = SAFE_PASSWORD_CHARS;
  const bound = Math.floor(256 / alphabet.length) * alphabet.length;
  const chars: string[] = [];
  while (chars.length < length) {
    const draw = crypto.getRandomValues(new Uint8Array(length * 2));
    for (let i = 0; i < draw.length && chars.length < length; i++) {
      const b = draw[i]!;
      if (b < bound) {
        chars.push(alphabet[b % alphabet.length]!);
      }
    }
  }
  return chars.join("");
}

/** Convenience: register the three built-in rotators against a rotator. */
export function registerBuiltins(rotator: SecretRotator): void {
  rotator.register("http_auth", httpAuthSecret);
  rotator.register("webhook_sign", webhookSigningSecret);
  rotator.register("db_password", () => databasePassword(24));
}
