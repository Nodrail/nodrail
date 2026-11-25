import { afterEach, describe, expect, test, vi } from "vitest";
import { appOrigin } from "@/server/app-origin";
import { loginEmailMessage, sendLoginEmail } from "@/server/auth/mail";

describe("the built-in login emails", () => {
  test.each(["sign-in", "verify", "reset"] as const)(
    "%s carries one link with the correct purpose",
    (kind) => {
      const { html, text } = loginEmailMessage(
        kind,
        "random-token",
        "https://app.example.test",
      );
      expect(html.match(/href=/g)).toHaveLength(1);
      expect(html).toContain(
        'href="https://app.example.test/auth/confirm?token=random-token',
      );
      expect(text).toContain(
        "https://app.example.test/auth/confirm?token=random-token",
      );
      if (kind === "reset") {
        expect(html).toContain("&amp;mode=reset");
        expect(text).toContain("&mode=reset");
      }
    },
  );
});

describe("login email origin", () => {
  afterEach(() => vi.unstubAllEnvs());

  test.each([
    "http://app.example.test",
    "http://localhost.example.test",
    "http://127.0.0.1.example.test",
    "http://192.168.1.9",
    "https://app.example.test/path",
  ])("refuses to send a token to an invalid origin (%s)", async (origin) => {
    vi.stubEnv("APP_ORIGIN", origin);
    await expect(async () =>
      sendLoginEmail("person@example.test", "reset", "token"),
    ).rejects.toThrow("HTTPS origin or a loopback HTTP origin");
  });

  test.each([
    "https://app.example.test",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://[::1]:3000",
  ])("accepts an HTTPS or loopback HTTP origin (%s)", (origin) => {
    vi.stubEnv("APP_ORIGIN", origin);
    expect(appOrigin()).toBe(origin);
  });
});
