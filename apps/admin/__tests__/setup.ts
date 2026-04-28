import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});

if (typeof globalThis.fetch === "undefined") {
  globalThis.fetch = (() => Promise.reject(new Error("fetch not stubbed"))) as typeof fetch;
}
