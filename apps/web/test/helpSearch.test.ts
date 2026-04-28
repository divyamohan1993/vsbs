import { describe, expect, it } from "vitest";
import { searchHelp } from "../src/lib/helpSearch";
import { HELP_ARTICLES } from "../src/content/help";

describe("helpSearch", () => {
  it("returns matching articles for a known token", () => {
    const results = searchHelp("refund");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.slug).toBe("refunds");
    expect(results[0]?.excerpt.length).toBeGreaterThan(0);
  });

  it("ranks the most relevant article first", () => {
    const results = searchHelp("command grant");
    expect(results[0]?.slug).toBe("command-grants");
  });

  it("returns an empty result on a query with no matches", () => {
    expect(searchHelp("zzzunknown")).toEqual([]);
  });

  it("indexes every article", () => {
    expect(HELP_ARTICLES.length).toBe(10);
  });
});
