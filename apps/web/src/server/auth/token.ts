import { createHash, randomBytes } from "node:crypto";

export const tokenDigest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export const newToken = () => randomBytes(32).toString("base64url");

export const isToken = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
