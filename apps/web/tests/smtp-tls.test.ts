import { afterEach, expect, test, vi } from "vitest";
import nodemailer from "nodemailer";
import { sendLoginEmail } from "@/server/auth/mail";

vi.mock("nodemailer", () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: vi.fn() })) },
}));

afterEach(() => vi.unstubAllEnvs());

test.each([
  {
    url: "smtp://relay.example.test",
    origin: "https://app.example.test",
    tls: { secure: false, requireTLS: true, port: 587 },
  },
  {
    url: "smtps://relay.example.test",
    origin: "https://app.example.test",
    tls: { secure: true, requireTLS: false, port: 465 },
  },
  {
    url: "smtp://127.0.0.1:2525",
    origin: "https://app.example.test",
    plainHost: "127.0.0.1",
    tls: { secure: false, requireTLS: true, port: 2525 },
  },
  {
    url: "smtp://127.0.0.1:2525",
    origin: "http://127.0.0.1:3100",
    tls: { secure: false, requireTLS: true, port: 2525 },
  },
  {
    url: "smtp://127.0.0.1:2525",
    origin: "http://127.0.0.1:3100",
    plainHost: "127.0.0.1",
    tls: { secure: false, requireTLS: false, port: 2525 },
  },
])(
  "protects login email sent via $url from $origin (override: $plainHost)",
  async ({ url, origin, plainHost, tls }) => {
    vi.stubEnv("SMTP_URL", url);
    vi.stubEnv("APP_ORIGIN", origin);
    vi.stubEnv("SMTP_PLAINTEXT_HOST", plainHost);
    vi.stubEnv("NOTIFICATIONS_FROM", "notifications@example.test");
    await sendLoginEmail("person@example.test", "reset", "token");
    expect(nodemailer.createTransport).toHaveBeenLastCalledWith(
      expect.objectContaining({ ...tls, tls: { rejectUnauthorized: true } }),
    );
  },
);
