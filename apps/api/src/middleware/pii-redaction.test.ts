import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { wrapLoggerWithRedaction } from "./pii-redaction.js";
import { Logger } from "../log.js";

describe("wrapLoggerWithRedaction", () => {
  const lines: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  beforeEach(() => {
    lines.length = 0;
    console.log = (s: string) => lines.push(s);
    console.error = (s: string) => lines.push(s);
  });
  afterEach(() => {
    console.log = origLog;
    console.error = origErr;
  });

  it("redacts phone numbers in info() fields", () => {
    const inner = new Logger("info");
    const log = wrapLoggerWithRedaction(inner);
    log.info("intake", { contact: "+919876543210", email: "x@y.com" });
    const merged = lines.join("\n");
    expect(merged).toContain("[REDACTED:phone-in]");
    expect(merged).toContain("[REDACTED:email]");
    expect(merged).not.toContain("9876543210");
    expect(merged).not.toContain("x@y.com");
  });

  it("redacts VINs in error() fields", () => {
    const inner = new Logger("info");
    const log = wrapLoggerWithRedaction(inner);
    log.error("vin_decode_failed", { vin: "1HGCM82633A004352" });
    const merged = lines.join("\n");
    expect(merged).toContain("[REDACTED:vin]");
    expect(merged).not.toContain("1HGCM82633A004352");
  });

  it("propagates redaction through child() loggers", () => {
    const inner = new Logger("info");
    const log = wrapLoggerWithRedaction(inner);
    const child = log.child({ tenant: "alice@example.com" });
    child.info("hi", { phone: "9876543210" });
    const merged = lines.join("\n");
    expect(merged).toContain("[REDACTED:email]");
    expect(merged).toContain("[REDACTED:phone-in]");
  });
});
