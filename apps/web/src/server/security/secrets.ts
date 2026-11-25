import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Only this is stored, so a database leak does not expose working secrets. */
export const digestSecret = (secret: string) =>
  createHash("sha256").update(secret).digest("hex");

export const newSecret = () => randomBytes(32).toString("base64url");

/** Compares a presented secret with a stored digest in constant time. */
export function matchesDigest(secret: string, storedDigest: string) {
  const expected = Buffer.from(storedDigest);
  const actual = Buffer.from(digestSecret(secret));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
