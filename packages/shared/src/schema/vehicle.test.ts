import { describe, it, expect } from "vitest";
import { vinCheckDigitValid, VinSchema, IndiaPlateSchema } from "./vehicle.js";

describe("vinCheckDigitValid", () => {
  it("accepts known-good Honda Accord VIN", () => {
    expect(vinCheckDigitValid("1HGCM82633A004352")).toBe(true);
  });

  it("accepts known-good Tesla Model S VIN", () => {
    expect(vinCheckDigitValid("5YJSA1H23EFP64533")).toBe(true);
  });

  it("rejects mutated check digit", () => {
    // Flip position 9 (check digit) from 3 to 4
    expect(vinCheckDigitValid("1HGCM82643A004352")).toBe(false);
  });

  it("rejects forbidden character I", () => {
    expect(vinCheckDigitValid("1HGCM82I33A004352")).toBe(false);
  });

  it("rejects forbidden character O", () => {
    expect(vinCheckDigitValid("1HGCM826O3A004352")).toBe(false);
  });

  it("rejects forbidden character Q", () => {
    expect(vinCheckDigitValid("1HGCM826Q3A004352")).toBe(false);
  });

  it("rejects wrong length", () => {
    expect(vinCheckDigitValid("1HGCM82633A00435")).toBe(false);
    expect(vinCheckDigitValid("1HGCM82633A0043522")).toBe(false);
  });
});

describe("VinSchema", () => {
  it("normalises lowercase input to uppercase and validates", () => {
    const out = VinSchema.parse("1hgcm82633a004352");
    expect(out).toBe("1HGCM82633A004352");
  });

  it("rejects invalid check digit", () => {
    expect(() => VinSchema.parse("1HGCM82643A004352")).toThrow();
  });
});

describe("IndiaPlateSchema", () => {
  it("accepts `DL 1C AB 1234` (spec form, spaces stripped pre length-check)", () => {
    // The schema now normalises whitespace + case before the length
    // bound, so the user-friendly spaced form is accepted and returned
    // as the canonical compact form.
    expect(IndiaPlateSchema.parse("DL 1C AB 1234")).toBe("DL1CAB1234");
  });

  it("accepts `MH12AB1234`", () => {
    expect(IndiaPlateSchema.parse("MH12AB1234")).toBe("MH12AB1234");
  });

  it("accepts lowercase", () => {
    expect(IndiaPlateSchema.parse("mh12ab1234")).toBe("MH12AB1234");
  });

  it("rejects nonsense", () => {
    expect(() => IndiaPlateSchema.parse("!!!!!!")).toThrow();
    expect(() => IndiaPlateSchema.parse("1234567")).toThrow();
  });

  it("rejects too short", () => {
    expect(() => IndiaPlateSchema.parse("ABC")).toThrow();
  });
});
