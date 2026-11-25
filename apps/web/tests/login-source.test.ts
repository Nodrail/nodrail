import { afterEach, expect, test, vi } from "vitest";
import { clientSource } from "@/server/auth/source";

afterEach(() => vi.unstubAllEnvs());

test("public self-hosted login accepts only a configured, single IP header", () => {
  vi.stubEnv("VERCEL", undefined);
  vi.stubEnv("APP_ORIGIN", "https://app.example.test");
  vi.stubEnv("AUTH_CLIENT_IP_HEADER", undefined);
  const request = new Headers({
    "x-forwarded-for": "192.0.2.1",
    "x-nodrail-peer": "192.0.2.2",
  });
  expect(clientSource(request)).toBeNull();
  vi.stubEnv("AUTH_CLIENT_IP_HEADER", "x-nodrail-peer");
  expect(clientSource(request)).toBe("192.0.2.2");
  request.append("x-nodrail-peer", "192.0.2.3");
  expect(clientSource(request)).toBeNull();
});

test("Vercel uses its edge header and normalizes sources", () => {
  vi.stubEnv("VERCEL", "1");
  const request = new Headers({ "x-forwarded-for": "192.0.2.3" });
  const header = "x-vercel-forwarded-for";
  expect(clientSource(request)).toBeNull();
  request.set(header, "::ffff:192.0.2.2");
  expect(clientSource(request)).toBe("192.0.2.2");
  request.set(header, "2001:0db8:1:2::1");
  const source = clientSource(request);
  request.set(header, "2001:db8:1:2:1234:5678:9abc:def0");
  expect(source).toBe("2001:db8:1:2::/64");
  expect(clientSource(request)).toBe(source);
});

test("local evaluation uses a single bucket without trusting headers", () => {
  vi.stubEnv("VERCEL", undefined);
  vi.stubEnv("AUTH_CLIENT_IP_HEADER", undefined);
  vi.stubEnv("APP_ORIGIN", "http://127.0.0.1:3100");
  expect(clientSource(new Headers({ "x-forwarded-for": "192.0.2.1" }))).toBe(
    "local",
  );
});
