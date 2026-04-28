// SHA-256 over a canonical JSON form. Used for evidence hashes on consent
// records, erasure receipts, breach notifications, and notice versions.

export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const bytesIn = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const buf = new ArrayBuffer(bytesIn.byteLength);
  new Uint8Array(buf).set(bytesIn);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const bytes = new Uint8Array(digest);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

// RFC 8785 JCS-aligned canonical JSON: keys sorted at every level, no
// whitespace, no trailing commas. Sufficient for evidence hashing of the
// notice payloads we control. Not a full JCS implementation (we never emit
// numbers requiring scientific normalisation in this surface).
export function canonicalJSON(value: unknown): string {
  return JSON.stringify(canonicalise(value));
}

function canonicalise(v: unknown): unknown {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(canonicalise);
  const out: Record<string, unknown> = {};
  const keys = Object.keys(v as Record<string, unknown>).sort();
  for (const k of keys) out[k] = canonicalise((v as Record<string, unknown>)[k]);
  return out;
}

export async function evidenceHash(payload: unknown): Promise<string> {
  return sha256Hex(canonicalJSON(payload));
}

// HMAC-SHA256 of an IP address with a per-process salt. Used to pseudonymise
// the IP in the consent log: same IP -> same hash within the process, but
// the original is never stored.
const ipSaltKeyPromise: Promise<CryptoKey> = (async () => {
  const salt = new Uint8Array(32);
  crypto.getRandomValues(salt);
  return crypto.subtle.importKey("raw", salt, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
})();

export async function hashIp(ip: string | undefined | null): Promise<string> {
  if (!ip) return "";
  const key = await ipSaltKeyPromise;
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(ip));
  const bytes = new Uint8Array(sig);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out.slice(0, 32);
}
