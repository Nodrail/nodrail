import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthCard } from "@/features/auth/components/auth-card";
import { PasswordForm } from "@/features/auth/components/password-form";
import { emailConfigured } from "@/server/notifications/mailer";
import { safeNextPath } from "@/features/auth/next-path";
import { getPrincipal } from "@/server/auth/current";

export const metadata: Metadata = { title: "Sign in", referrer: "no-referrer" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next: destination, reauth } = await searchParams;
  const next = safeNextPath(destination);
  if (reauth !== "1" && (await getPrincipal())) redirect(next);
  const emailEnabled = emailConfigured();
  return (
    <AuthCard
      eyebrow="Welcome back"
      title="Sign in to Nodrail"
      intro="Continue to your team workspace."
      footer={
        emailEnabled ? (
          <>
            <Link href={`/auth/link?next=${encodeURIComponent(next)}`}>
              Email me a sign-in link
            </Link>
            {" · "}
            <Link href={`/auth/reset?next=${encodeURIComponent(next)}`}>
              Forgot password?
            </Link>
            {" · "}
            <Link href="/signup">Create an account</Link>
          </>
        ) : (
          <>
            Need an account or a password reset? Contact your server
            administrator.
          </>
        )
      }
    >
      <PasswordForm next={next} />
    </AuthCard>
  );
}
