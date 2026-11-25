// What a real credential looks like. Shared by the repository check and the
// public repository exports, so neither can fall behind the other.
export const secretPatterns = [
  ["Stripe live key", /\b[sr]k_live_[A-Za-z0-9]{10,}/],
  ["Stripe test key", /\bsk_test_[A-Za-z0-9]{20,}/],
  ["Stripe webhook secret", /\bwhsec_[A-Za-z0-9+/]{24,}/],
  ["Legacy hosted credential", /\b(?:sb_secret_|sbp_)[A-Za-z0-9_-]{20,}/],
  [
    "JSON web token",
    /\beyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+/,
  ],
  [
    "GitHub token",
    /\b(?:gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{40,})/,
  ],
  ["npm token", /\bnpm_[A-Za-z0-9]{36}\b/],
  ["AWS key", /\bAKIA[0-9A-Z]{16}\b(?<!AKIAIOSFODNN7EXAMPLE)/],
  ["Anthropic or OpenAI key", /\bsk-(?:ant-)?[A-Za-z0-9_-]{32,}/],
  ["Slack token", /\bxox[abprs]-[0-9A-Za-z-]{20,}/],
  ["Private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  [
    "Database password",
    /postgres(?:ql)?:\/\/[^:/\s"'`$]+:(?!nodrail_local_only@|password@|\$\{)[^@\s"'`$]+@/,
  ],
  ["Nodrail credential", /\bndr_[0-9a-f]{12}_[A-Za-z0-9_-]{43}\b/],
  ["Nodrail API token", /\bndp_[0-9a-f]{12}_[A-Za-z0-9_-]{43}\b/],
];

// Files that must never be tracked, whatever they contain.
export const forbiddenNames =
  /(^|\/)(\.env(\.(?!example$)[^/]+)?|id_rsa|[^/]+\.pem|[^/]+\.p12)$/;
