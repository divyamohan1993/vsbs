// =============================================================================
// VSBS API client. Built on the global `fetch` that Expo / React Native
// expose (Hermes ships fetch + URL + AbortController natively). Every
// response is validated against the corresponding Zod schema from
// @vsbs/shared so the client never trusts the wire blindly.
//
// Auth tokens are kept in expo-secure-store so they sit in the iOS
// Keychain / Android Keystore rather than AsyncStorage.
//
// Idempotency: every mutation includes an Idempotency-Key (UUID v4) per
// the API contract in apps/api/src/routes/payment.ts. The shared payment
// state machine in @vsbs/shared/payment is the source of truth.
// =============================================================================

import { z } from "zod";
import * as SecureStore from "expo-secure-store";
import {
  OtpStartRequestSchema,
  OtpStartResponseSchema,
  OtpVerifyRequestSchema,
  OtpVerifyResponseSchema,
  type OtpStartRequest,
  type OtpVerifyRequest,
} from "@vsbs/shared";

import { resolveBaseUrl } from "./region";

const TOKEN_KEY = "vsbs.session.token";
const SUBJECT_KEY = "vsbs.session.subject";

interface ApiEnvelope<T> {
  data: T;
}

const EnvelopeSchema = <T extends z.ZodTypeAny>(inner: T) =>
  z.object({ data: inner });

const ErrorBodySchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
    requestId: z.string().optional(),
  }),
});

export class ApiError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly requestId?: string;
  public readonly details?: unknown;
  constructor(opts: { code: string; message: string; status: number; requestId?: string; details?: unknown }) {
    super(opts.message);
    this.code = opts.code;
    this.status = opts.status;
    if (opts.requestId !== undefined) this.requestId = opts.requestId;
    if (opts.details !== undefined) this.details = opts.details;
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
  idempotencyKey?: string;
  authenticated?: boolean;
  timeoutMs?: number;
}

function uuid(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  // Fallback for unusual runtimes — RFC 4122 v4 from Math.random.
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export class VsbsApiClient {
  private baseUrl: string | null = null;

  async resolveBase(): Promise<string> {
    if (!this.baseUrl) this.baseUrl = await resolveBaseUrl();
    return this.baseUrl;
  }

  setBaseUrl(url: string): void {
    this.baseUrl = url;
  }

  async getToken(): Promise<string | null> {
    return SecureStore.getItemAsync(TOKEN_KEY);
  }

  async setToken(token: string, subject: string): Promise<void> {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    await SecureStore.setItemAsync(SUBJECT_KEY, subject);
  }

  async clearToken(): Promise<void> {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    await SecureStore.deleteItemAsync(SUBJECT_KEY);
  }

  async getSubject(): Promise<string | null> {
    return SecureStore.getItemAsync(SUBJECT_KEY);
  }

  async request<T>(path: string, schema: z.ZodType<T>, opts: RequestOptions = {}): Promise<T> {
    const base = await this.resolveBase();
    const url = `${base}${path}`;
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-request-id": uuid(),
    };
    if (opts.idempotencyKey || opts.method !== "GET") {
      headers["idempotency-key"] = opts.idempotencyKey ?? uuid();
    }
    if (opts.authenticated !== false) {
      const token = await this.getToken();
      if (token) headers["authorization"] = `Bearer ${token}`;
    }
    const controller = new AbortController();
    const timeoutMs = opts.timeoutMs ?? 15_000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const userSignal = opts.signal;
    const onUserAbort = () => controller.abort();
    if (userSignal) userSignal.addEventListener("abort", onUserAbort);

    try {
      const fetchInit: RequestInit = {
        method: opts.method ?? "GET",
        headers,
        signal: controller.signal,
      };
      if (opts.body !== undefined) fetchInit.body = JSON.stringify(opts.body);
      const res = await fetch(url, fetchInit);
      const text = await res.text();
      const json: unknown = text.length > 0 ? JSON.parse(text) : {};
      if (!res.ok) {
        const parsed = ErrorBodySchema.safeParse(json);
        if (parsed.success) {
          throw new ApiError({
            code: parsed.data.error.code,
            message: parsed.data.error.message,
            status: res.status,
            ...(parsed.data.error.requestId !== undefined ? { requestId: parsed.data.error.requestId } : {}),
            ...(parsed.data.error.details !== undefined ? { details: parsed.data.error.details } : {}),
          });
        }
        throw new ApiError({ code: "HTTP_ERROR", message: `HTTP ${res.status}`, status: res.status });
      }
      const envelope = EnvelopeSchema(schema).safeParse(json);
      if (!envelope.success) {
        throw new ApiError({
          code: "SCHEMA_MISMATCH",
          message: "Response did not match expected schema",
          status: res.status,
          details: envelope.error.flatten(),
        });
      }
      return envelope.data.data as T;
    } finally {
      clearTimeout(timer);
      if (userSignal) userSignal.removeEventListener("abort", onUserAbort);
    }
  }

  // -------------------- Auth --------------------

  async otpStart(req: OtpStartRequest) {
    const validated = OtpStartRequestSchema.parse(req);
    return this.request("/v1/auth/otp/start", OtpStartResponseSchema, {
      method: "POST",
      body: validated,
      authenticated: false,
    });
  }

  async otpVerify(req: OtpVerifyRequest) {
    const validated = OtpVerifyRequestSchema.parse(req);
    return this.request("/v1/auth/otp/verify", OtpVerifyResponseSchema, {
      method: "POST",
      body: validated,
      authenticated: false,
    });
  }

  // -------------------- Bookings --------------------

  async createBooking(payload: BookingCreate): Promise<Booking> {
    const validated = BookingCreateSchema.parse(payload);
    return this.request<Booking>("/v1/bookings", BookingSchema, {
      method: "POST",
      body: validated,
    });
  }

  async getBooking(id: string): Promise<Booking> {
    return this.request<Booking>(`/v1/bookings/${encodeURIComponent(id)}`, BookingSchema);
  }

  // -------------------- VIN decode --------------------

  async decodeVin(vin: string): Promise<VinDecodeResult> {
    return this.request<VinDecodeResult>(
      `/v1/vin/${encodeURIComponent(vin)}`,
      VinDecodeResultSchema,
    );
  }

  // -------------------- Sensors ingest --------------------

  async ingestSensorSamples(samples: unknown[]): Promise<SensorIngestResult> {
    return this.request<SensorIngestResult>("/v1/sensors/ingest", SensorIngestResultSchema, {
      method: "POST",
      body: { samples },
    });
  }

  // -------------------- Consent + erasure --------------------

  async deleteSelf(): Promise<{ ok: true }> {
    return this.request("/v1/me", z.object({ ok: z.literal(true) }), {
      method: "DELETE",
    });
  }

  // -------------------- Concierge SSE --------------------

  /** Open a streaming POST to /v1/concierge/turn. Returns the raw Response. */
  async openConciergeStream(payload: { conversationId: string; userMessage: string }, signal?: AbortSignal): Promise<Response> {
    const base = await this.resolveBase();
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-request-id": uuid(),
      "accept": "text/event-stream",
    };
    const token = await this.getToken();
    if (token) headers["authorization"] = `Bearer ${token}`;
    const init: RequestInit = {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    };
    if (signal !== undefined) init.signal = signal;
    return fetch(`${base}/v1/concierge/turn`, init);
  }

  /** Open a GET-stream to /v1/bookings/:id/stream. */
  async openBookingStream(id: string, signal?: AbortSignal): Promise<Response> {
    const base = await this.resolveBase();
    const headers: Record<string, string> = {
      "x-request-id": uuid(),
      "accept": "text/event-stream",
    };
    const token = await this.getToken();
    if (token) headers["authorization"] = `Bearer ${token}`;
    const init: RequestInit = { method: "GET", headers };
    if (signal !== undefined) init.signal = signal;
    return fetch(`${base}/v1/bookings/${encodeURIComponent(id)}/stream`, init);
  }
}

// -------------------- Local schemas (kept narrow; mirror the API) --------------------

export const BookingCreateSchema = z.object({
  owner: z.object({
    phone: z.string().min(1),
    subject: z.string().optional(),
  }),
  vehicle: z.object({
    vin: z.string().optional(),
    make: z.string().optional(),
    model: z.string().optional(),
    year: z.number().int().optional(),
  }),
  issue: z.object({
    symptoms: z.string().min(1),
    canDriveSafely: z.enum([
      "yes-confidently",
      "yes-cautiously",
      "unsure",
      "no",
      "already-stranded",
    ]),
    redFlags: z.array(z.string()),
  }),
  safety: z.object({
    severity: z.enum(["red", "amber", "green"]),
    rationale: z.string().min(1),
    triggered: z.array(z.string()),
  }),
  source: z.enum(["web", "agent", "api", "mobile"]).optional(),
});
export type BookingCreate = z.infer<typeof BookingCreateSchema>;

export const BookingSchema = BookingCreateSchema.extend({
  id: z.string(),
  status: z.enum(["accepted", "in-progress", "ready", "complete"]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  source: z.enum(["web", "agent", "api", "mobile"]),
});
export type Booking = z.infer<typeof BookingSchema>;

export const VinDecodeResultSchema = z.object({
  vin: z.string(),
  make: z.string().optional(),
  model: z.string().optional(),
  year: z.number().int().optional(),
  fuel: z.string().optional(),
  raw: z.unknown().optional(),
});
export type VinDecodeResult = z.infer<typeof VinDecodeResultSchema>;

export const SensorIngestResultSchema = z.object({
  accepted: z.number().int().nonnegative(),
  observationId: z.string().uuid().optional(),
});
export type SensorIngestResult = z.infer<typeof SensorIngestResultSchema>;

export const apiClient = new VsbsApiClient();
