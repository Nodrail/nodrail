import { readFileSync } from "node:fs";
import { isLoopbackHost } from "../loopback.ts";

function allowsPlaintext(host: string) {
  return (
    isLoopbackHost(host) ||
    (process.env.NODRAIL_DEPLOYMENT === "self-hosted" &&
      host === process.env.DATABASE_PLAINTEXT_HOST)
  );
}

const tlsParams = ["sslmode", "sslcert", "sslkey"];

function verifyFullMode(params: URLSearchParams) {
  const verifyFull = params.get("sslmode") === "verify-full";
  const invalidOption = [...params.keys()].some(
    (key) =>
      ((key.startsWith("ssl") || key === "uselibpqcompat") &&
        !tlsParams.includes(key)) ||
      (tlsParams.includes(key) && params.getAll(key).length > 1),
  );
  if (invalidOption || (params.has("sslmode") && !verifyFull))
    throw new Error("Database URLs accept only sslmode=verify-full for TLS");
  return verifyFull;
}

export function databaseConnection(url: string) {
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();
  if (parsed.searchParams.has("host") || parsed.searchParams.has("hostaddr"))
    throw new Error("Specify the database host in the URL authority");

  const verifyFull = verifyFullMode(parsed.searchParams);
  const ca = process.env.DATABASE_CA?.trim().replaceAll("\\n", "\n");
  const cert = parsed.searchParams.get("sslcert");
  const key = parsed.searchParams.get("sslkey");
  if (ca || verifyFull) {
    for (const parameter of tlsParams) parsed.searchParams.delete(parameter);
    return {
      connectionString: parsed.href,
      ssl: {
        ...(ca ? { ca } : {}),
        ...(cert ? { cert: readFileSync(cert, "utf8") } : {}),
        ...(key ? { key: readFileSync(key, "utf8") } : {}),
        rejectUnauthorized: true as const,
      },
    };
  }

  if (allowsPlaintext(host) && !cert && !key)
    return { connectionString: url, ssl: false as const };
  throw new Error(
    "Remote Postgres requires DATABASE_CA or sslmode=verify-full",
  );
}
