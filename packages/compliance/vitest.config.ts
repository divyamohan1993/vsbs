import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@vsbs/shared": new URL("../shared/src/index.ts", import.meta.url).pathname,
    },
  },
});
