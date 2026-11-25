// Security headers for both apps' next.config.ts. Plain JavaScript, so the
// config loader reads it without compiling it.

const google =
  " https://www.googletagmanager.com https://*.google-analytics.com https://*.analytics.google.com";
const challenges = "https://challenges.cloudflare.com";

/**
 * Prerendered pages cannot carry a per-request nonce, and Next.js needs inline
 * bootstrap scripts, so scripts are limited by origin rather than by nonce.
 * Add origins only for integrations configured on the surface.
 *
 * @param {{ posthog?: boolean; tagManager?: boolean; turnstile?: boolean }} origins
 */
export function contentSecurityPolicy({ posthog, tagManager, turnstile }) {
  const tags = tagManager ? google : "";
  const challenge = turnstile ? ` ${challenges}` : "";
  const assets = posthog ? " https://us-assets.i.posthog.com" : "";
  const ingest = posthog ? " https://us.i.posthog.com" : "";
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${challenge}${tags}${assets}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data:${tags}`,
    ...(turnstile ? [`frame-src ${challenges}`] : []),
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    `connect-src 'self'${tags}${ingest}${assets}`,
  ].join("; ");
}

const permissionsPolicy =
  "camera=(), microphone=(), geolocation=(), browsing-topics=()";

/**
 * The headers every response carries. The policy and HSTS only in
 * production, where the app is served over HTTPS from its own build.
 *
 * @param {string} policy the Content-Security-Policy
 */
export function securityHeaders(policy) {
  return [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Permissions-Policy", value: permissionsPolicy },
    ...(process.env.NODE_ENV === "production"
      ? [
          { key: "Content-Security-Policy", value: policy },
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
        ]
      : []),
  ];
}
