import "server-only";
import {
  createPublicKey,
  verify,
  type KeyObject,
  type webcrypto,
} from "node:crypto";
import { z } from "zod";
import {
  GITHUB_ACTIONS_ISSUER,
  TOKEN_CLOCK_SKEW_SECONDS,
  TOKEN_MAX_AGE_SECONDS,
} from "@/contracts/v1/evidence";
import { EvidenceError } from "./errors";

/**
 * GitHub Actions OIDC tokens: an RS256 JWT signed by one of the
 * keys GitHub publishes, from its issuer, live and recently issued. Only
 * signature, issuer and time are checked here; the audience and the
 * verifier's repository, workflow and refs are the caller's, because they
 * depend on the workspace the audience names.
 */

const GITHUB_JWKS_URL = `${GITHUB_ACTIONS_ISSUER}/.well-known/jwks`;
/** How long published keys are trusted before being read again. */
const KEYS_TTL_MS = 10 * 60_000;
/** An unknown `kid` reads the keys again, at most this often. */
const REFRESH_MIN_MS = 30_000;
const FETCH_TIMEOUT_MS = 3_000;

/** A signing key by its `kid`, or null when the issuer has none by that id. */
export type KeySource = (kid: string) => Promise<KeyObject | null>;

const jwks = z.object({
  keys: z
    .array(
      z
        .object({ kid: z.string().min(1), kty: z.string() })
        .catchall(z.unknown()),
    )
    .max(50),
});

/**
 * Keys read from a JWKS URL, cached for 10 minutes and read again early
 * when a token names a key the cache doesn't have (GitHub rotates them).
 */
export function jwksKeySource(
  url: string,
  fetcher: typeof fetch = fetch,
): KeySource {
  let keys = new Map<string, KeyObject>();
  let readAt = 0;
  let reading: Promise<void> | null = null;
  const read = () =>
    (reading ??= (async () => {
      try {
        const response = await fetcher(url, {
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          headers: { accept: "application/json" },
        });
        if (!response.ok) throw new EvidenceError("verifier-unavailable");
        const parsed = jwks.safeParse(await response.json());
        if (!parsed.success) throw new EvidenceError("verifier-unavailable");
        const next = new Map<string, KeyObject>();
        for (const key of parsed.data.keys) {
          if (key.kty !== "RSA") continue;
          try {
            next.set(
              key.kid,
              createPublicKey({
                key: key as webcrypto.JsonWebKey,
                format: "jwk",
              }),
            );
          } catch {
            // A key this server can't read can't sign anything it accepts.
          }
        }
        keys = next;
        readAt = Date.now();
      } catch (error) {
        throw error instanceof EvidenceError
          ? error
          : new EvidenceError("verifier-unavailable");
      } finally {
        reading = null;
      }
    })());
  return async (kid) => {
    const age = Date.now() - readAt;
    if (age > KEYS_TTL_MS || (!keys.has(kid) && age > REFRESH_MIN_MS))
      await read();
    return keys.get(kid) ?? null;
  };
}

/** The keys GitHub signs Actions tokens with. */
export const githubActionsKeys: KeySource = jwksKeySource(GITHUB_JWKS_URL);

const header = z.object({ alg: z.literal("RS256"), kid: z.string().min(1) });

/** The claims evidence uses; GitHub sends more, which are ignored. */
const claims = z.object({
  iss: z.string(),
  aud: z.union([z.string(), z.array(z.string())]),
  exp: z.number().int(),
  iat: z.number().int(),
  nbf: z.number().int().optional(),
  jti: z.string().min(1).max(200),
  sha: z.string(),
  ref: z.string().min(1).max(500),
  repository: z.string().min(1).max(200),
  repository_id: z.string().regex(/^[1-9][0-9]{0,19}$/),
  job_workflow_ref: z.string().min(1).max(500),
  run_id: z.string().regex(/^[0-9]{1,20}$/),
  run_attempt: z.string().regex(/^[0-9]{1,5}$/),
  event_name: z.string().max(100),
  actor_id: z.string().max(40).optional(),
});
export type ActionsClaims = z.infer<typeof claims>;

const segment = (part: string | undefined) => {
  if (!part || !/^[A-Za-z0-9_-]+$/.test(part))
    throw new EvidenceError("token-invalid");
  return Buffer.from(part, "base64url");
};

const json = (part: string | undefined): unknown => {
  try {
    return JSON.parse(segment(part).toString("utf8"));
  } catch (error) {
    if (error instanceof EvidenceError) throw error;
    throw new EvidenceError("token-invalid");
  }
};

/**
 * The token's claims once its signature, issuer and times hold. `now` is
 * in seconds. Anything else is `token-invalid`: which check failed is not
 * told to the caller.
 */
export async function verifyActionsToken(
  token: string,
  keys: KeySource,
  now = Math.floor(Date.now() / 1000),
): Promise<ActionsClaims> {
  if (token.length > 8192) throw new EvidenceError("token-invalid");
  const parts = token.split(".");
  if (parts.length !== 3) throw new EvidenceError("token-invalid");
  const [rawHeader, rawClaims, signature] = parts;
  const head = header.safeParse(json(rawHeader));
  if (!head.success) throw new EvidenceError("token-invalid");
  const key = await keys(head.data.kid);
  if (!key) throw new EvidenceError("token-invalid");
  const signed = verify(
    "RSA-SHA256",
    Buffer.from(`${rawHeader}.${rawClaims}`),
    key,
    segment(signature),
  );
  if (!signed) throw new EvidenceError("token-invalid");
  const read = claims.safeParse(json(rawClaims));
  if (!read.success) throw new EvidenceError("token-invalid");
  const c = read.data;
  const skew = TOKEN_CLOCK_SKEW_SECONDS;
  const live =
    c.iss === GITHUB_ACTIONS_ISSUER &&
    now <= c.exp + skew &&
    c.iat <= now + skew &&
    now - c.iat <= TOKEN_MAX_AGE_SECONDS + skew &&
    (c.nbf === undefined || c.nbf <= now + skew);
  if (!live) throw new EvidenceError("token-invalid");
  return c;
}

/**
 * Whether a run's ref matches a verifier's glob: `*` stays within one
 * path part, `**` crosses them. Exact otherwise.
 */
export function refMatches(glob: string, ref: string) {
  const pattern = glob
    .split("**")
    .map((part) =>
      part
        .split("*")
        .map((text) => text.replace(/[.+?^${}()|[\]\\/]/g, "\\$&"))
        .join("[^/]*"),
    )
    .join(".*");
  return new RegExp(`^${pattern}$`).test(ref);
}
