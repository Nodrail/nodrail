import "server-only";
import { createHmac } from "node:crypto";
import { z } from "zod";

const keyId = /^[A-Za-z0-9_-]{1,32}$/;
const localId = "local-v1";
const configuration = z.strictObject({
  current: z
    .string()
    .regex(keyId)
    .refine((id) => id !== localId),
  keys: z.record(
    z
      .string()
      .regex(keyId)
      .refine((id) => id !== localId),
    z.strictObject({
      secret: z.string().regex(/^[a-f0-9]{64}$/i),
      verifyUntil: z.iso.datetime().optional(),
    }),
  ),
  localVerifyUntil: z.iso.datetime().optional(),
});

let cached: { raw: string; ring: z.infer<typeof configuration> } | undefined;

function keyring() {
  const raw = process.env.NODRAIL_ADMISSION_KEYS || undefined;
  if (raw === undefined) return undefined;
  if (cached?.raw === raw) return cached.ring;
  try {
    const ring = configuration.parse(JSON.parse(raw));
    if (
      !Object.hasOwn(ring.keys, ring.current) ||
      ring.keys[ring.current]?.verifyUntil ||
      Object.entries(ring.keys).some(
        ([id, key]) => id !== ring.current && !key.verifyUntil,
      )
    )
      throw new Error("invalid keyring");
    cached = { raw, ring };
    return ring;
  } catch {
    throw new Error(
      "Invalid NODRAIL_ADMISSION_KEYS. Configure one current key and a verification deadline for each retired key.",
    );
  }
}

export function proofExpiry(now: number) {
  const seconds = process.env.NODRAIL_ADMISSION_TTL_SECONDS || "604800";
  const ttl = Number(seconds);
  if (
    !/^[0-9]+$/.test(seconds) ||
    !Number.isSafeInteger(ttl) ||
    ttl < 1 ||
    ttl > 2_147_483_647
  )
    throw new Error(
      "NODRAIL_ADMISSION_TTL_SECONDS must be a positive integer of seconds.",
    );
  return now + ttl;
}

function localKey(seed: string) {
  // Use a distinct signing subkey. The installation seed stays fixed so
  // existing pause replay fingerprints survive every signing-key rotation.
  return createHmac("sha256", seed)
    .update("admission-signing:local-v1")
    .digest();
}

export function signingKey(seed: string) {
  const ring = keyring();
  if (!ring) return { id: localId, key: localKey(seed) };
  return {
    id: ring.current,
    key: Buffer.from(ring.keys[ring.current]!.secret, "hex"),
  };
}

export function verificationKey(seed: string, id: string, now: number) {
  const ring = keyring();
  if (id === localId) {
    if (
      !ring ||
      (ring.localVerifyUntil && now * 1000 < Date.parse(ring.localVerifyUntil))
    )
      return localKey(seed);
    return undefined;
  }
  const entry =
    ring && Object.hasOwn(ring.keys, id) ? ring.keys[id] : undefined;
  if (
    entry &&
    (id === ring?.current ||
      (entry.verifyUntil && now * 1000 < Date.parse(entry.verifyUntil)))
  )
    return Buffer.from(entry.secret, "hex");
  return undefined;
}
