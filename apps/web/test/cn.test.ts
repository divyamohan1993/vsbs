import { describe, expect, it } from "vitest";
import { cn } from "../src/components/ui/cn";

describe("cn", () => {
  it("joins truthy strings", () => {
    expect(cn("a", "b", "c")).toBe("a b c");
  });

  it("filters falsy values", () => {
    expect(cn("a", null, undefined, false, "", "b")).toBe("a b");
  });

  it("flattens nested arrays", () => {
    expect(cn(["a", ["b", null], "c"])).toBe("a b c");
  });

  it("expands object maps for active keys", () => {
    expect(cn({ a: true, b: false, c: 1 })).toBe("a c");
  });
});
