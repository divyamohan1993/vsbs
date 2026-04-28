import { describe, expect, it } from "vitest";
import { motionDuration, motionEase } from "../src/lib/motion";

describe("motion", () => {
  it("returns named cubic-bezier eases", () => {
    expect(motionEase("out-quint")).toMatch(/cubic-bezier/);
    expect(motionEase("linear")).toMatch(/cubic-bezier/);
  });

  it("exposes 150/200/300 ms durations", () => {
    expect(motionDuration("fast")).toBe(150);
    expect(motionDuration("base")).toBe(200);
    expect(motionDuration("slow")).toBe(300);
  });
});
