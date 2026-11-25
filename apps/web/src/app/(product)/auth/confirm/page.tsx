import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { AuthCard } from "@/features/auth/components/auth-card";
import { isToken } from "@/server/auth/token";
import { emailConfigured } from "@/server/notifications/mailer";
import { ConfirmForm } from "@/features/auth/components/confirm-form";

export const metadata: Metadata = {
  title: "Confirm sign-in",
  referrer: "no-referrer",
};

export default async function ConfirmPage({
  searchParams,
}: PageProps<"/auth/confirm">) {
  const { token, mode } = await searchParams;
  if (!emailConfigured())
    return (
      <AuthCard
        eyebrow="Sign in"
        title="Email login is unavailable"
        intro="Ask your server administrator for help with your password."
      >
        <Link href="/login">Back to sign in</Link>
      </AuthCard>
    );
  if (!isToken(token))
    return (
      <AuthCard
        eyebrow="Sign in"
        title="This link is incomplete"
        intro="Open the full link from your email, or ask for a new one."
      >
        <Button asChild size="lg" className="w-full">
          <Link href="/login">Get a new link</Link>
        </Button>
      </AuthCard>
    );
  const reset = mode === "reset";
  return (
    <AuthCard
      eyebrow="Sign in"
      title={reset ? "Reset your password" : "Continue to Nodrail"}
      intro={
        reset
          ? "Choose a password with at least 12 characters."
          : "Confirm that you want to sign in on this device."
      }
    >
      <ConfirmForm token={token} reset={reset} />
    </AuthCard>
  );
}
