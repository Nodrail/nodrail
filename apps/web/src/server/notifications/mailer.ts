import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { isLoopbackHost } from "@/server/loopback";
import type { RenderedEmail } from "./render";

export type OutgoingEmail = RenderedEmail & { to: string; messageId: string };
export type SendEmail = (email: OutgoingEmail) => Promise<void>;

function smtpOptions(url: string) {
  const parsed = new URL(url);
  const secure = parsed.protocol === "smtps:";
  if (!secure && parsed.protocol !== "smtp:")
    throw new Error("SMTP_URL must use smtp or smtps");
  const host = parsed.hostname.toLowerCase();
  const origin = process.env.APP_ORIGIN;
  const localPlaintext =
    origin &&
    isLoopbackHost(new URL(origin).hostname) &&
    host === process.env.SMTP_PLAINTEXT_HOST;

  return {
    host: host.replace(/^\[|\]$/g, ""),
    port: parsed.port ? Number(parsed.port) : secure ? 465 : 587,
    secure,
    requireTLS: !secure && !localPlaintext,
    tls: { rejectUnauthorized: true },
    auth: parsed.username
      ? {
          user: decodeURIComponent(parsed.username),
          pass: decodeURIComponent(parsed.password),
        }
      : undefined,
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 10_000,
  };
}

let transport: { key: string; client: Transporter } | undefined;

function getTransport(url: string) {
  const key = JSON.stringify([
    url,
    process.env.APP_ORIGIN,
    process.env.SMTP_PLAINTEXT_HOST,
  ]);
  if (transport?.key !== key)
    transport = { key, client: nodemailer.createTransport(smtpOptions(url)) };
  return transport.client;
}

export const emailConfigured = () =>
  Boolean(process.env.SMTP_URL && process.env.NOTIFICATIONS_FROM);

export const sendEmail: SendEmail = async ({ to, messageId, ...content }) => {
  const url = process.env.SMTP_URL;
  const from = process.env.NOTIFICATIONS_FROM;
  if (!url || !from) throw new Error("Email is not configured");
  await getTransport(url).sendMail({
    from,
    to,
    messageId: `<${messageId}@notifications.nodrail>`,
    ...content,
  });
};
