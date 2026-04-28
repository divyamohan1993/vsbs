import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/eval/**/*.test.ts"],
    passWithNoTests: true,
    environment: "node",
    testTimeout: 60_000,
  },
});
