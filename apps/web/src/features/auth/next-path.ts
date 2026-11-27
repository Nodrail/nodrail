import {
  isProductPath,
  productPath,
  shortProductUrls,
} from "@/lib/product-path";

export const AUTH_RETURN_PATH_HEADER = "x-nodrail-auth-return-path";

const PLAIN_PATH = /^\/[A-Za-z0-9_\-/]*$/;
const INVITE = /^\/invite\/[A-Za-z0-9_-]+$/;

/**
 * Only same-site product paths: never `//host`, a backslash trick or an
 * absolute URL. Anything else opens the product home.
 */
export function safeNextPath(
  value: unknown,
  short: boolean = shortProductUrls,
): string {
  const home = productPath("", short);
  if (typeof value !== "string" || !PLAIN_PATH.test(value)) return home;
  if (value.includes("//")) return home;
  if (/^\/api\/v1\/cli\/login\/approve\/[a-f0-9]{64}$/.test(value))
    return value;
  if (INVITE.test(value) || isProductPath(value, short)) return value;
  return home;
}
