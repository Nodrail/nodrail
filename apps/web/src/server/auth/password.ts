import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const parameters = { N: 2 ** 17, r: 8, p: 1, maxmem: 160 * 1024 * 1024 };
const scheme = "scrypt-v1";
const saltLength = 16;
const keyLength = 32;

// Run the same KDF for missing accounts and accounts without a local password.
const dummySalt = randomBytes(saltLength);
const dummyKey = randomBytes(keyLength);

export const loginEmail = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email().max(254));
export const newPassword = z.string().min(12).max(256);

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, parameters, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string) {
  const salt = randomBytes(saltLength);
  const key = await derive(newPassword.parse(password), salt);
  return [scheme, salt.toString("hex"), key.toString("hex")].join("$");
}

export async function verifyPassword(password: string, stored: string | null) {
  const [version, hexSalt = "", hexKey = ""] = stored?.split("$") ?? [];
  const salt = Buffer.from(hexSalt, "hex");
  const key = Buffer.from(hexKey, "hex");
  const valid =
    version === scheme &&
    salt.length === saltLength &&
    key.length === keyLength;
  const actual = await derive(password, valid ? salt : dummySalt);
  return timingSafeEqual(actual, valid ? key : dummyKey) && valid;
}
