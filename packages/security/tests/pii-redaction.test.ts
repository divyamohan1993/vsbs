import { describe, it, expect } from "vitest";
import {
  makeRedactionEngine,
  verhoeffValid,
  luhnValid,
} from "../src/pii-redaction.js";

const eng = makeRedactionEngine();

describe("PII redaction — positive cases", () => {
  it("redacts email", () => {
    expect(eng.redactString("Reach divya@dmj.one for help"))
      .toBe("Reach [REDACTED:email] for help");
  });

  it("redacts +91 phone", () => {
    expect(eng.redactString("call +91 9876543210 now"))
      .toBe("call [REDACTED:phone-in] now");
  });

  it("redacts bare 10-digit Indian mobile starting with 6/7/8/9", () => {
    expect(eng.redactString("ph 9876543210"))
      .toBe("ph [REDACTED:phone-in]");
  });

  it("redacts a Verhoeff-valid Aadhaar", () => {
    // 234123412346 — known Verhoeff-valid sample (UIDAI dummy).
    expect(verhoeffValid("234123412346")).toBe(true);
    expect(eng.redactString("aadhaar 2341 2341 2346"))
      .toContain("[REDACTED:aadhaar]");
  });

  it("redacts PAN", () => {
    expect(eng.redactString("PAN: ABCDE1234F"))
      .toBe("PAN: [REDACTED:pan]");
  });

  it("redacts Indian VRN with allow-listed state code", () => {
    expect(eng.redactString("plate MH12AB1234"))
      .toContain("[REDACTED:vrn]");
  });

  it("redacts a 17-char VIN", () => {
    expect(eng.redactString("VIN 1HGCM82633A004352"))
      .toBe("VIN [REDACTED:vin]");
  });

  it("redacts IPv4", () => {
    expect(eng.redactString("from 203.0.113.42 today"))
      .toBe("from [REDACTED:ip] today");
  });

  it("redacts a Luhn-valid credit card", () => {
    expect(luhnValid("4242424242424242")).toBe(true);
    expect(eng.redactString("card 4242 4242 4242 4242"))
      .toBe("card [REDACTED:credit-card]");
  });

  it("redacts IFSC", () => {
    expect(eng.redactString("ifsc HDFC0001234"))
      .toBe("ifsc [REDACTED:ifsc]");
  });

  it("redacts GPS coordinates fully for log", () => {
    expect(eng.redactString("at 28.6139, 77.2090"))
      .toContain("[REDACTED:gps]");
  });

  it("quantises GPS for LLM prompts", () => {
    const out = eng.redactForLLM("at 28.6139, 77.2090") as string;
    expect(out).toContain("GPS~28.61,77.20");
  });
});

describe("PII redaction — negative cases (no false positives)", () => {
  it("does NOT redact a 12-digit string that fails Verhoeff", () => {
    // 123456789012 — not a valid Aadhaar.
    expect(verhoeffValid("123456789012")).toBe(false);
    expect(eng.redactString("not aadhaar 1234 5678 9012"))
      .not.toContain("[REDACTED:aadhaar]");
  });

  it("does NOT redact a digit run that fails Luhn", () => {
    expect(luhnValid("1234567890123456")).toBe(false);
    const out = eng.redactString("trash 1234 5678 9012 3456");
    expect(out).not.toContain("[REDACTED:credit-card]");
  });

  it("does NOT treat XX99XX9999 with bogus state code as VRN", () => {
    expect(eng.redactString("XX12AB1234"))
      .toBe("XX12AB1234");
  });

  it("preserves safe tokens (greeting + non-PII)", () => {
    expect(eng.redactString("Hello world how are you"))
      .toBe("Hello world how are you");
  });
});

describe("redactForLog deeply walks objects", () => {
  it("redacts string fields in nested objects and arrays", () => {
    const out = eng.redactForLog({
      user: { email: "x@y.com", phone: "+919876543210" },
      events: ["IP=203.0.113.42", "ok"],
    }) as { user: { email: string; phone: string }; events: string[] };
    expect(out.user.email).toBe("[REDACTED:email]");
    expect(out.user.phone).toBe("[REDACTED:phone-in]");
    expect(out.events[0]).toContain("[REDACTED:ip]");
  });

  it("does not blow up on Date / Uint8Array / null", () => {
    const obj = { a: null, b: new Date(0), c: new Uint8Array([1, 2]) };
    const out = eng.redactForLog(obj) as typeof obj;
    expect(out.a).toBeNull();
    expect(out.b).toBeInstanceOf(Date);
    expect(out.c).toBeInstanceOf(Uint8Array);
  });
});
