import { expect, test } from "vitest";
import { loginConnectionUrl } from "../scripts/hosted-endpoint.mjs";

test("a conventional Postgres owner URL supplies the runtime endpoint", () => {
  const owner = new URL(
    "postgres://owner:password@db.example.test:5444/nodrail?sslmode=verify-full",
  );
  expect(loginConnectionUrl(owner, "nodrail_prod_app", "password")).toBe(
    "postgres://nodrail_prod_app:password@db.example.test:5444/nodrail?sslmode=verify-full",
  );
  expect(owner.username).toBe("owner");
});

test("an explicit pooler endpoint and suffix apply to the auth login", () => {
  const pooler = new URL("postgres://pooler.example.test:6543/postgres");
  expect(
    loginConnectionUrl(pooler, "nodrail_prod_auth", "password", "project"),
  ).toBe(
    "postgres://nodrail_prod_auth.project:password@pooler.example.test:6543/postgres",
  );
});
