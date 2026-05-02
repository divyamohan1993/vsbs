// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Divya Mohan / dmj.one

import { describe, expect, it } from "vitest";
import {
  prettyBytes,
  prettyDuration,
  prettyTime,
  shortId,
} from "../src/lib/recordings";

describe("prettyBytes", () => {
  it("renders bytes below the kilobyte boundary verbatim", () => {
    expect(prettyBytes(0)).toBe("0 B");
    expect(prettyBytes(512)).toBe("512 B");
    expect(prettyBytes(1023)).toBe("1023 B");
  });

  it("renders kilobytes, megabytes and gigabytes at one decimal", () => {
    expect(prettyBytes(1024)).toBe("1.0 KB");
    expect(prettyBytes(1536)).toBe("1.5 KB");
    expect(prettyBytes(13_000_000)).toBe("12.4 MB");
    expect(prettyBytes(2 * 1024 * 1024 * 1024)).toBe("2.0 GB");
  });

  it("treats negative or non-finite inputs as zero", () => {
    expect(prettyBytes(-1)).toBe("0 B");
    expect(prettyBytes(Number.NaN)).toBe("0 B");
    expect(prettyBytes(Number.POSITIVE_INFINITY)).toBe("0 B");
  });
});

describe("prettyDuration", () => {
  it("zero pads the minutes and seconds segments", () => {
    expect(prettyDuration(0)).toBe("00:00");
    expect(prettyDuration(7)).toBe("00:07");
    expect(prettyDuration(65)).toBe("01:05");
    expect(prettyDuration(330)).toBe("05:30");
    expect(prettyDuration(3600)).toBe("60:00");
  });

  it("clamps negative or non-finite inputs to zero", () => {
    expect(prettyDuration(-12)).toBe("00:00");
    expect(prettyDuration(Number.NaN)).toBe("00:00");
  });
});

describe("prettyTime", () => {
  it("renders HH:MM:SS for a valid ISO timestamp", () => {
    const iso = "2026-05-02T07:08:09.000Z";
    const out = prettyTime(iso);
    expect(out).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it("returns a sentinel for malformed input", () => {
    expect(prettyTime("not-a-date")).toBe("--:--:--");
    expect(prettyTime("")).toBe("--:--:--");
  });
});

describe("shortId", () => {
  it("returns the first eight characters of an id", () => {
    expect(shortId("0123456789abcdef")).toBe("01234567");
    expect(shortId("abc")).toBe("abc");
  });

  it("returns an empty string when the id is not a string", () => {
    expect(shortId(undefined as unknown as string)).toBe("");
  });
});
