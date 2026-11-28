import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import { PHASE_PRODUCTION_BUILD } from "next/constants";
import {
  contentSecurityPolicy,
  securityHeaders,
} from "@nodrail/web-shared/security";
import { assertVercelDeployment } from "./src/server/deployment-env.mjs";

// On its own host the product drops `/app` from its URLs (src/lib/host-routing.ts).
// Previews and local runs have no app host and keep `/app`.
const shortProductUrls =
  process.env.NEXT_PUBLIC_SHORT_PRODUCT_URLS ||
  String(Boolean(process.env.APP_HOST));

// Self-hosting (Dockerfile): one folder with the server and what it needs,
// traced from the repository root since the app uses workspace packages.
const standalone =
  process.env.NEXT_OUTPUT === "standalone"
    ? {
        output: "standalone" as const,
        outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
      }
    : {};

const nextConfig: NextConfig = {
  ...standalone,
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  poweredByHeader: false,
  devIndicators: false,
  serverExternalPackages: ["typeorm"],
  transpilePackages: ["@nodrail/sdk"],
  // Inlined into server and browser code alike; see src/lib/product-path.ts.
  env: { NEXT_PUBLIC_SHORT_PRODUCT_URLS: shortProductUrls },
  experimental: {
    globalNotFound: true,
    caseSensitiveRoutes: true,
    inlineCss: true,
  },
  async headers() {
    const policy = contentSecurityPolicy({
      posthog: Boolean(process.env.NEXT_PUBLIC_POSTHOG_KEY),
    });
    return [{ source: "/:path*", headers: securityHeaders(policy) }];
  },
};

export default function config(phase: string): NextConfig {
  if (phase === PHASE_PRODUCTION_BUILD) assertVercelDeployment();
  return nextConfig;
}
