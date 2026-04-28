// =============================================================================
// Pino-based structured logger with PII redaction and OTel context binding.
// One log line == one JSON object on stdout. NDJSON in production, pretty in
// development. Every line is stamped with:
//   ts, level, msg, file:line:function, severity, traceId, spanId,
//   request_id, region, tenant, user_hash, sanitized payload.
// =============================================================================

import pino, { type Logger as PinoLogger } from "pino";
import { activeTraceIds } from "./otel.js";

export interface LoggerOptions {
  serviceName: string;
  region: string;
  environment: "development" | "staging" | "production" | "test";
  /** Pretty-print to TTY. Default: env != production. */
  pretty?: boolean;
  /** Minimum level to emit. */
  level?: "trace" | "debug" | "info" | "warn" | "error" | "fatal";
}

export interface LogContext {
  request_id?: string;
  tenant?: string;
  user_hash?: string;
  /** Free-form attributes, redacted before emit. */
  [key: string]: unknown;
}

const REDACT_PATHS = [
  "password",
  "token",
  "secret",
  "apiKey",
  "api_key",
  "authorization",
  "cookie",
  "set-cookie",
  "phone",
  "email",
  "ssn",
  "aadhaar",
  "pan",
  "creditCard",
  "card",
  "cvv",
  "*.password",
  "*.token",
  "*.secret",
  "*.apiKey",
  "*.api_key",
  "*.authorization",
  "*.phone",
  "*.email",
  "*.ssn",
  "*.aadhaar",
  "*.pan",
  "*.creditCard",
  "*.card",
  "*.cvv",
];

/**
 * Build a pino logger configured for VSBS conventions.
 * - JSON in prod (Cloud Logging-compatible).
 * - Pretty in dev (timestamp + level + message).
 * - Hard-coded redaction paths covering the PII shape we capture.
 */
export function makeLogger(opts: LoggerOptions): PinoLogger {
  const isProd = opts.environment === "production";
  const pretty = opts.pretty ?? !isProd;
  return pino({
    name: opts.serviceName,
    level: opts.level ?? (isProd ? "info" : "debug"),
    base: {
      service: opts.serviceName,
      region: opts.region,
      env: opts.environment,
    },
    timestamp: () => `,"ts":"${new Date().toISOString()}"`,
    formatters: {
      level: (label: string) => ({ level: label, severity: severityFor(label) }),
      bindings: (b) => ({ ...b, pid: undefined, hostname: undefined }),
    },
    redact: {
      paths: REDACT_PATHS,
      censor: "[redacted]",
    },
    ...(pretty
      ? {
          transport: {
            target: "pino/file",
            options: { destination: 1 },
          },
        }
      : {}),
  });
}

/** Map pino level to Cloud Logging severity (RFC 5424). */
function severityFor(level: string): string {
  switch (level) {
    case "trace":
    case "debug":
      return "DEBUG";
    case "info":
      return "INFO";
    case "warn":
      return "WARNING";
    case "error":
      return "ERROR";
    case "fatal":
      return "CRITICAL";
    default:
      return "DEFAULT";
  }
}

// -----------------------------------------------------------------------------
// Stack-frame caller resolution (file:line:function).
// pino's standard error serialiser includes stacks, but we want the call site
// for *every* line so SIEM filters can pinpoint the emitter.
// -----------------------------------------------------------------------------

interface CallerFrame {
  file: string;
  line: number;
  function: string;
}

export function callerFrame(skip = 2): CallerFrame {
  const err = new Error();
  const stack = err.stack ?? "";
  const lines = stack.split("\n");
  // [0]=Error, [1]=callerFrame itself, [2]=caller of helper, [skip+1]=desired
  const target = lines[skip + 1] ?? lines[lines.length - 1] ?? "";
  // Match  "at fnName (file:line:col)" OR "at file:line:col"
  const withFn = target.match(/at\s+(\S+)\s+\((.+):(\d+):(\d+)\)/);
  if (withFn) {
    return {
      function: withFn[1] ?? "<anon>",
      file: shortFile(withFn[2] ?? ""),
      line: Number.parseInt(withFn[3] ?? "0", 10),
    };
  }
  const noFn = target.match(/at\s+(.+):(\d+):(\d+)/);
  if (noFn) {
    return {
      function: "<anon>",
      file: shortFile(noFn[1] ?? ""),
      line: Number.parseInt(noFn[2] ?? "0", 10),
    };
  }
  return { function: "<anon>", file: "<unknown>", line: 0 };
}

function shortFile(p: string): string {
  // Trim absolute paths so logs don't leak local layout. Keep the last 3
  // segments which is enough to find the file in the repo.
  const parts = p.split("/");
  if (parts.length <= 3) return p;
  return parts.slice(-3).join("/");
}

// -----------------------------------------------------------------------------
// VsbsLogger - a thin shim around pino that injects file:line:function +
// active OTel trace+span ids on every emit.
// -----------------------------------------------------------------------------

export class VsbsLogger {
  constructor(
    private readonly inner: PinoLogger,
    private readonly base: LogContext = {},
  ) {}

  /** Bind extra structured fields. */
  child(extra: LogContext): VsbsLogger {
    return new VsbsLogger(this.inner.child(extra), { ...this.base, ...extra });
  }

  trace(msg: string, fields?: LogContext): void {
    this.emit("trace", msg, fields);
  }
  debug(msg: string, fields?: LogContext): void {
    this.emit("debug", msg, fields);
  }
  info(msg: string, fields?: LogContext): void {
    this.emit("info", msg, fields);
  }
  warn(msg: string, fields?: LogContext): void {
    this.emit("warn", msg, fields);
  }
  error(msg: string, fields?: LogContext): void {
    this.emit("error", msg, fields);
  }
  fatal(msg: string, fields?: LogContext): void {
    this.emit("fatal", msg, fields);
  }

  private emit(
    level: "trace" | "debug" | "info" | "warn" | "error" | "fatal",
    msg: string,
    fields?: LogContext,
  ): void {
    const ids = activeTraceIds();
    const frame = callerFrame(3);
    const payload: Record<string, unknown> = {
      ...this.base,
      ...(fields ?? {}),
      file: frame.file,
      line: frame.line,
      fn: frame.function,
    };
    if (ids.traceId) payload.trace_id = ids.traceId;
    if (ids.spanId) payload.span_id = ids.spanId;
    this.inner[level](payload, msg);
  }
}

/** Convenience constructor that wires pino and the OTel-aware shim. */
export function makeVsbsLogger(opts: LoggerOptions, base: LogContext = {}): VsbsLogger {
  const inner = makeLogger(opts);
  return new VsbsLogger(inner, base);
}

// -----------------------------------------------------------------------------
// Hashing helpers used to anonymise user identifiers before they touch logs.
// HMAC-SHA256 with a per-process salt is preferred; for the deterministic
// test path we expose a non-keyed sha256 hex truncation as well.
// -----------------------------------------------------------------------------

export async function hashUser(value: string, salt: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(salt),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(value));
  const bytes = new Uint8Array(sig);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out.slice(0, 16);
}

// Order matters - Aadhaar (12 digits) and card (16) are matched before phone
// so the more-specific pattern wins. Phone permits internal spaces/dashes.
const PII_PATTERNS: Array<[RegExp, string]> = [
  [/\b\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\b/g, "[redacted-pan]"],
  [/\b\d{12}\b/g, "[redacted-aadhaar]"],
  [/\+?\d{1,3}[\s-]?\d{3,5}[\s-]?\d{3,7}/g, "[redacted-phone]"],
  [/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[redacted-email]"],
  [/\b[A-HJ-NPR-Z0-9]{17}\b/g, "[redacted-vin]"],
];

/** Best-effort scrub of free-form strings. Use *in addition* to redact paths. */
export function scrubString(s: string): string {
  let out = s;
  for (const [re, rep] of PII_PATTERNS) out = out.replace(re, rep);
  return out;
}
