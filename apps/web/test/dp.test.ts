import { describe, expect, it } from "vitest";
import {
  addGaussianNoise,
  addLaplaceNoise,
  kAnonymise,
  noisedMean,
  seededRng,
} from "../src/lib/dp";

describe("kAnonymise", () => {
  it("returns rows untouched when k=1", () => {
    const rows = [
      { city: "Delhi", role: "owner", spend: 100 },
      { city: "Pune", role: "owner", spend: 80 },
    ];
    const r = kAnonymise(rows, 1, ["city", "role"]);
    expect(r.rows.length).toBe(2);
    expect(r.suppressed).toBe(0);
  });

  it("preserves classes that meet the threshold and drops smaller ones", () => {
    const big = Array.from({ length: 5 }, () => ({ city: "Delhi", role: "owner", spend: 100 }));
    const small = [
      { city: "Pune", role: "owner", spend: 50 },
      { city: "Pune", role: "owner", spend: 60 },
    ];
    const r = kAnonymise([...big, ...small], 5, ["city", "role"]);
    expect(r.classes).toBe(1);
    expect(r.rows.length).toBe(5);
    expect(r.suppressed).toBeCloseTo(2 / 7, 5);
  });

  it("k-anonymity holds: every surviving class has at least k members", () => {
    const rows = [
      ...Array.from({ length: 8 }, () => ({ os: "android", route: "/book" })),
      ...Array.from({ length: 6 }, () => ({ os: "ios", route: "/book" })),
      ...Array.from({ length: 2 }, () => ({ os: "linux", route: "/book" })),
    ];
    const r = kAnonymise(rows, 5, ["os", "route"]);
    const sizes = new Map<string, number>();
    for (const row of r.rows) {
      const key = `${row.os}|${row.route}`;
      sizes.set(key, (sizes.get(key) ?? 0) + 1);
    }
    for (const v of sizes.values()) {
      expect(v).toBeGreaterThanOrEqual(5);
    }
    // Linux's 2 rows should all be suppressed.
    expect(sizes.get("linux|/book")).toBeUndefined();
  });

  it("generalises numeric quasi-identifiers to power-of-2 bands", () => {
    // Ages 30 and 32 both fall into the 16-31 / 32-63 band (so different).
    // Ages 33 and 50 both fall into the 32-63 band.
    const rows = [
      { age: 33, role: "owner" },
      { age: 50, role: "owner" },
      { age: 60, role: "owner" },
      { age: 40, role: "owner" },
      { age: 35, role: "owner" },
      { age: 5, role: "owner" },
    ];
    const r = kAnonymise(rows, 5, ["age", "role"]);
    expect(r.classes).toBeGreaterThanOrEqual(1);
    // The five 33-60 ages share the 32-band and survive; the age=5 row is dropped.
    expect(r.rows.length).toBe(5);
  });

  it("returns zero classes on empty input", () => {
    const r = kAnonymise<{ a: string }>([], 5, ["a"]);
    expect(r.rows).toEqual([]);
    expect(r.classes).toBe(0);
  });
});

describe("addLaplaceNoise", () => {
  it("returns a finite number near the input on a single draw", () => {
    const v = addLaplaceNoise(100, 1, 1, { rng: seededRng(42n) });
    expect(Number.isFinite(v)).toBe(true);
  });

  it("Laplace mean over many samples converges to the true value", () => {
    const rng = seededRng(0xdeadbeefn);
    const true_ = 50;
    let s = 0;
    const N = 10_000;
    for (let i = 0; i < N; i++) {
      s += addLaplaceNoise(true_, 1, 1, { rng });
    }
    const empMean = s / N;
    // Variance of Laplace(0, 1) is 2; std error of mean over 10k draws
    // is sqrt(2/10000) ~= 0.014. Allow 0.2 tolerance for a comfortable margin.
    expect(Math.abs(empMean - true_)).toBeLessThan(0.2);
  });

  it("rejects invalid sensitivity / epsilon", () => {
    expect(() => addLaplaceNoise(1, 0, 1)).toThrow();
    expect(() => addLaplaceNoise(1, 1, 0)).toThrow();
    expect(() => addLaplaceNoise(Infinity, 1, 1)).toThrow();
  });
});

describe("addGaussianNoise", () => {
  it("Gaussian mean over many samples converges to the true value", () => {
    const rng = seededRng(0xfeedfacen);
    const true_ = 25;
    let s = 0;
    const N = 10_000;
    for (let i = 0; i < N; i++) {
      s += addGaussianNoise(true_, 1, 1, 1e-5, { rng });
    }
    const empMean = s / N;
    // Sigma here ~= sqrt(2 ln(125000)) ~= 4.84; std err of mean ~= 0.05.
    expect(Math.abs(empMean - true_)).toBeLessThan(0.5);
  });

  it("rejects delta out of (0, 1)", () => {
    expect(() => addGaussianNoise(1, 1, 1, 0)).toThrow();
    expect(() => addGaussianNoise(1, 1, 1, 1)).toThrow();
    expect(() => addGaussianNoise(1, 1, 1, -0.1)).toThrow();
  });
});

describe("noisedMean", () => {
  it("converges to true mean over many draws", () => {
    const rng = seededRng(0x12345n);
    const data: number[] = [];
    for (let i = 0; i < 1000; i++) data.push(50 + (i % 5) - 2);
    const trueMean = data.reduce((a, b) => a + b, 0) / data.length;
    let s = 0;
    const trials = 200;
    for (let t = 0; t < trials; t++) s += noisedMean(data, 100, 1, { rng });
    const empMean = s / trials;
    expect(Math.abs(empMean - trueMean)).toBeLessThan(2);
  });
});

describe("seededRng", () => {
  it("returns the same sequence for the same seed", () => {
    const a = seededRng(0xc0ffeen);
    const b = seededRng(0xc0ffeen);
    for (let i = 0; i < 10; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  it("produces values in [0, 1)", () => {
    const r = seededRng(0xbabe1n);
    for (let i = 0; i < 1000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
