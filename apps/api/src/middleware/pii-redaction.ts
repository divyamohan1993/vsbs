// =============================================================================
// PII redaction wrapper around the structured logger.
//
// Every log line emitted by the API passes through `redactForLog` before it
// reaches the structured logger. This is the LLM02 mitigation from
// docs/research/security.md §4 — log files are a real exfiltration vector,
// and the only safe default is to never let raw PII enter them.
//
// Usage:
//   const baseLog = new Logger("info", { svc: "vsbs-api" });
//   const log = wrapLoggerWithRedaction(baseLog);
//   log.info("intake_received", { phone: "+919876543210" }); // emits [REDACTED:phone-in]
// =============================================================================

import { Logger, type LogFields } from "../log.js";
import { makeRedactionEngine, type RedactionEngine } from "@vsbs/security";

export class RedactingLogger extends Logger {
  readonly #inner: Logger;
  readonly #engine: RedactionEngine;

  constructor(inner: Logger, engine: RedactionEngine = makeRedactionEngine()) {
    super("trace", {});
    this.#inner = inner;
    this.#engine = engine;
  }

  override child(extra: LogFields): Logger {
    const safe = this.#engine.redactForLog(extra) as LogFields;
    return new RedactingLogger(this.#inner.child(safe), this.#engine);
  }

  override trace(msg: string, f?: LogFields): void {
    this.#inner.trace(msg, f ? (this.#engine.redactForLog(f) as LogFields) : undefined);
  }
  override debug(msg: string, f?: LogFields): void {
    this.#inner.debug(msg, f ? (this.#engine.redactForLog(f) as LogFields) : undefined);
  }
  override info(msg: string, f?: LogFields): void {
    this.#inner.info(msg, f ? (this.#engine.redactForLog(f) as LogFields) : undefined);
  }
  override warn(msg: string, f?: LogFields): void {
    this.#inner.warn(msg, f ? (this.#engine.redactForLog(f) as LogFields) : undefined);
  }
  override error(msg: string, f?: LogFields): void {
    this.#inner.error(msg, f ? (this.#engine.redactForLog(f) as LogFields) : undefined);
  }
}

export function wrapLoggerWithRedaction(inner: Logger): Logger {
  return new RedactingLogger(inner);
}
