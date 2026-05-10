import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [react()],
	test: {
		include: [
			"src/**/*.test.ts",
			"src/**/*.test.tsx",
			"test/**/*.test.ts",
			"test/**/*.test.tsx",
		],
		passWithNoTests: true,
		environment: "jsdom",
		setupFiles: ["./test/setup.ts"],
		globals: true,
	},
	resolve: {
		alias: {
			"@": new URL("./src", import.meta.url).pathname,
		},
	},
});
