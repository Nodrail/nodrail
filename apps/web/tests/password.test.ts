import { expect, test } from "vitest";
import {
  hashPassword,
  loginEmail,
  verifyPassword,
} from "@/server/auth/password";

const password = "correct-test-passphrase";

test("password hashes use independent salts", async () => {
  const first = await hashPassword(password);
  const next = await hashPassword(password);
  expect(first).toMatch(/^scrypt-v1\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
  expect(next).not.toBe(first);
});

test("password verification requires a correct password and a local hash", async () => {
  const hash = await hashPassword(password);
  await expect(verifyPassword(password, hash)).resolves.toBe(true);
  await expect(verifyPassword("different-test-passphrase", hash)).resolves.toBe(
    false,
  );
  await expect(verifyPassword(password, null)).resolves.toBe(false);
});

test("account matching uses a single normalized email", () => {
  expect(loginEmail.parse("  Owner@Example.Test  ")).toBe("owner@example.test");
  expect(loginEmail.safeParse("not an address").success).toBe(false);
});
