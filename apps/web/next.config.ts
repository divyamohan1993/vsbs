import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Next.js 16: `cacheComponents` (the productionised PPR) is opt-in per
  // page via `export const experimental_cacheComponents = true`. For the
  // v0.1 demo every page is dynamic; we enable cacheComponents per-page
  // once we have static shells that warrant it.
  cacheComponents: false,
  // React Compiler is stable in React 19 / Next.js 16 and moved out of experimental.
  reactCompiler: true,
  typedRoutes: true,
  logging: { fetches: { fullUrl: false } },
  // CSP is injected per-request in src/middleware.ts using a nonce.
  // Static headers only here.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "geolocation=(self), microphone=(), camera=()" },
        ],
      },
    ];
  },
};

export default withNextIntl(config);
