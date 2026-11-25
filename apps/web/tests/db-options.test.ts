import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterEach, describe, expect, test, vi } from "vitest";
import { dataSourceOptions } from "@/server/db/options";

describe("entities", () => {
  test("each keeps its own name, even when the build shortens class names", () => {
    const { entities } = dataSourceOptions("postgres://127.0.0.1/db") as {
      entities: { name: string }[];
    };
    const names = entities.map((entity) => entity.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).not.toContain("ApprovalRequest");
    expect(names).toContain("UsageAlert");
    expect(names).toContain("Workspace");
  });
});

describe("database connections", () => {
  afterEach(() => vi.unstubAllEnvs());
  test("a configured CA enables TLS with identity checks for any Postgres host", () => {
    vi.stubEnv("DATABASE_CA", "line one\\nline two");
    try {
      expect(dataSourceOptions("postgres://db.example.test/db")).toMatchObject({
        ssl: { ca: "line one\nline two", rejectUnauthorized: true },
      });
      for (const option of ["sslmode=disable", "ssl=0"])
        expect(() =>
          dataSourceOptions(`postgres://db.example.test/db?${option}`),
        ).toThrow("only sslmode=verify-full");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  test("remote Postgres fails configuration checks without verified TLS", () => {
    const url = "postgres://db.example.test/db";
    expect(() => dataSourceOptions(url)).toThrow("Remote Postgres requires");
    for (const query of ["sslmode=disable", "sslmode=require", "ssl=no-verify"])
      expect(() => dataSourceOptions(`${url}?${query}`)).toThrow("verify-full");
    expect(dataSourceOptions(`${url}?sslmode=verify-full`)).toMatchObject({
      url,
      ssl: { rejectUnauthorized: true },
    });
    expect(() =>
      dataSourceOptions("postgres://127.0.0.1/db?host=db.example.test"),
    ).toThrow("URL authority");
  });

  test("only the configured self-hosted private database host can opt out", () => {
    vi.stubEnv("NODRAIL_DEPLOYMENT", "self-hosted");
    vi.stubEnv("DATABASE_PLAINTEXT_HOST", "postgres");
    try {
      expect(dataSourceOptions("postgres://postgres/db")).toMatchObject({
        ssl: false,
      });
      expect(() => dataSourceOptions("postgres://other/db")).toThrow(
        "Remote Postgres requires",
      );
      vi.stubEnv("NODRAIL_DEPLOYMENT", "cloud");
      expect(() => dataSourceOptions("postgres://postgres/db")).toThrow(
        "Remote Postgres requires",
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  test("pg receives file-backed client credentials alongside a verified CA", () => {
    vi.stubEnv("DATABASE_CA", "custom CA");
    const directory = mkdtempSync(join(tmpdir(), "nodrail tls "));
    try {
      const cert = join(directory, "client.crt");
      const key = join(directory, "client.key");
      writeFileSync(cert, "client certificate");
      writeFileSync(key, "client key");
      const url = new URL("postgres://database.example/db?sslmode=verify-full");
      url.searchParams.set("sslcert", cert);
      url.searchParams.set("sslkey", key);
      expect(dataSourceOptions(url.href)).toMatchObject({
        url: "postgres://database.example/db",
        ssl: {
          ca: "custom CA",
          cert: "client certificate",
          key: "client key",
          rejectUnauthorized: true,
        },
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("the driver is handed over, so hosted builds include it", () => {
    expect(dataSourceOptions("postgres://127.0.0.1/db")).toMatchObject({
      driver: pg,
    });
  });

  test("the local database needs no certificate", () => {
    expect(dataSourceOptions("postgres://127.0.0.1:54329/db")).toMatchObject({
      ssl: false,
    });
  });
});
