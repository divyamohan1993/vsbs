// Jest config for the VSBS mobile app.
//
// We deliberately do NOT use the jest-expo preset for unit tests: it
// pulls in the full React Native JS setup, including Flow-typed
// js-polyfills that Jest cannot parse without an RN-aware transformer.
// Our tests are pure-logic (Zod schemas, OBD parser, theme tokens, SSE
// parser, offline queue, analytics) and don't render components, so a
// plain ts-jest preset on Node is the right tool. UI-rendering tests
// would belong to Detox / e2e, not Jest.
//
// react-native and any other RN-specific module is mocked at the test
// file level via jest.mock() — keeps each test self-contained and
// avoids surprise transforms.

/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  setupFiles: ["<rootDir>/jest.setup.js"],
  testMatch: ["**/__tests__/**/*.test.ts", "**/__tests__/**/*.test.tsx"],
  extensionsToTreatAsEsm: [".ts", ".tsx"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    "^@vsbs/shared$": "<rootDir>/../../packages/shared/src/index.ts",
    "^@vsbs/shared/(.*)$": "<rootDir>/../../packages/shared/src/$1",
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.(t|j)sx?$": [
      "ts-jest",
      {
        useESM: true,
        tsconfig: {
          module: "ESNext",
          moduleResolution: "Bundler",
          jsx: "react-jsx",
          target: "ES2022",
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          isolatedModules: true,
          strict: true,
          noUncheckedIndexedAccess: false,
          exactOptionalPropertyTypes: false,
          skipLibCheck: true,
          types: [],
          paths: {
            "@/*": ["./src/*"],
            "@vsbs/shared": ["../../packages/shared/src/index.ts"],
            "@vsbs/shared/*": ["../../packages/shared/src/*"],
          },
        },
      },
    ],
  },
  transformIgnorePatterns: ["/node_modules/(?!(zod|@vsbs)/)"],
};
