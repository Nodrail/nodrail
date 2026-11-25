import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AuthCard } from "@/features/auth/components/auth-card";
import { SignInForm } from "@/features/auth/components/sign-in-form";
import { safeNextPath } from "@/features/auth/next-path";
import { emailConfigured } from "@/server/notifications/mailer";

export const metadata: Metadata = { referrer: "no-referrer" };

export default async function EmailLoginPage({
  params,
  searchParams,
}: PageProps<"/auth/[method]">) {
  const { method } = await params;
  if (method !== "link" && method !== "reset") notFound();
  const reset = method === "reset";
  const enabled = emailConfigured();
  const next = safeNextPath((await searchParams).next);

  return (
    <AuthCard
      eyebrow="Sign in"
      title={reset ? "Reset your password" : "Sign in with email"}
      intro={
        enabled
          ? "Enter your email and we’ll send you a link."
          : "Ask your server administrator for help with your password."
      }
      footer={<Link href="/login">Back to sign in</Link>}
    >
      {enabled && (
        <SignInForm
          next={next}
          method={reset ? "reset" : "sign-in"}
          submitLabel={reset ? "Send a reset link" : "Send a sign-in link"}
        />
      )}
    </AuthCard>
  );
}
