import { describe, expect, it } from "vitest";
import {
  makeVsbsLogger,
  scrubString,
  hashUser,
  callerFrame,
} from "../src/logger.js";

describe("scrubString", () => {
  it("redacts phone numbers", () => {
    expect(scrubString("call +91 98765 43210 now")).toContain("[redacted-phone]");
  });

  it("redacts emails", () => {
    expect(scrubString("contact divya@example.com please")).toContain("[redacted-email]");
  });

  it("redacts VINs (17 chars)", () => {
    expect(scrubString("VIN 1HGCM82633A123456 ok")).toContain("[redacted-vin]");
  });

  it("redacts Aadhaar 12-digit ids", () => {
    expect(scrubString("aadhaar 123456789012 here")).toContain("[redacted-aadhaar]");
  });

  it("redacts PAN-style 16-digit card numbers", () => {
    expect(scrubString("card 4111 1111 1111 1111")).toContain("[redacted-pan]");
  });
});

describe("hashUser", () => {
  it("produces a stable 16-char hex digest for the same salt+value", async () => {
    const a = await hashUser("user@example.com", "salt-abc");
    const b = await hashUser("user@example.com", "salt-abc");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it("produces different digests for different salts", async () => {
    const a = await hashUser("user@example.com", "salt-a");
    const b = await hashUser("user@example.com", "salt-b");
    expect(a).not.toBe(b);
  });
});

describe("callerFrame", () => {
  it("returns a non-empty file path and line number", () => {
    const f = callerFrame(1);
    expect(f.file).not.toBe("");
    expect(f.line).toBeGreaterThan(0);
  });
});

describe("VsbsLogger", () => {
  it("emits without throwing on each level", () => {
    const log = makeVsbsLogger({
      serviceName: "vsbs-test",
      region: "asia-south1",
      environment: "test",
      level: "trace",
    });
    expect(() => log.trace("t")).not.toThrow();
    expect(() => log.debug("d")).not.toThrow();
    expect(() => log.info("i")).not.toThrow();
    expect(() => log.warn("w")).not.toThrow();
    expect(() => log.error("e", { rid: "abc" })).not.toThrow();
  });

  it("returns a child with merged base context", () => {
    const log = makeVsbsLogger({
      serviceName: "vsbs-test",
      region: "asia-south1",
      environment: "test",
    });
    const child = log.child({ tenant: "in" });
    expect(child).toBeDefined();
    expect(() => child.info("hello", { request_id: "rid-1" })).not.toThrow();
  });
});
