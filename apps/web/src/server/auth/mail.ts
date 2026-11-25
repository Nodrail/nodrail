import "server-only";
import { randomUUID } from "node:crypto";
import type { LoginLinkKind } from "@/server/db/auth-entities";
import { appOrigin } from "@/server/app-origin";
import { brandedEmail } from "@/server/notifications/email-layout";
import { sendEmail } from "@/server/notifications/mailer";

const subjects = {
  "sign-in": "Sign in to Nodrail",
  verify: "Verify your email for Nodrail",
  reset: "Reset your Nodrail password",
};

export function loginEmailMessage(
  kind: LoginLinkKind,
  token: string,
  origin: string,
) {
  const url = new URL("/auth/confirm", origin);
  url.searchParams.set("token", token);
  if (kind === "reset") url.searchParams.set("mode", "reset");
  const subject = subjects[kind];
  const label = kind === "reset" ? "Set a new password" : "Continue to Nodrail";
  const body = "This link works once and expires in 15 minutes.";
  const footnote = "If you did not ask for this, you can ignore this email.";
  return {
    subject,
    html: brandedEmail({
      heading: subject,
      paragraphs: [body],
      action: { label, href: url.href.replaceAll("&", "&amp;") },
      footnote,
    }),
    text: `${subject}\n\n${body}\n${url.href}\n\n${footnote}`,
  };
}

export function sendLoginEmail(to: string, kind: LoginLinkKind, token: string) {
  return sendEmail({
    ...loginEmailMessage(kind, token, appOrigin()),
    messageId: randomUUID(),
    to,
  });
}
