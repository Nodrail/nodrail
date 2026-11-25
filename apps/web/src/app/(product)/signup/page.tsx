import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthCard } from "@/features/auth/components/auth-card";
import { SignInForm } from "@/features/auth/components/sign-in-form";
import { emailConfigured } from "@/server/notifications/mailer";
import { getPrincipal } from "@/server/auth/current";
import { appPath } from "@/lib/product-path";
import { plans } from "@/contracts/v1/billing";
import { deploymentMode } from "@/server/deployment";

const freeActions = plans.free.intentsPerMonth.toLocaleString("en-US");

const purpose =
  "Publish your policy, watch runs and decisions, and share budgets and evidence across your team.";

/** The Cloud plan in one line; a self-hosted server has no plan to sell. */
const intro = () =>
  deploymentMode() === "self-hosted"
    ? purpose
    : `${purpose} Free: ${freeActions} agent actions a month. No credit card.`;

export const metadata: Metadata = { title: "Create a workspace" };

export default async function SignupPage() {
  if (await getPrincipal()) redirect(appPath());
  const emailEnabled = emailConfigured();
  return (
    <AuthCard
      eyebrow="The open control plane for AI agent development"
      title="Start your workspace"
      intro={
        emailEnabled
          ? intro()
          : "Ask your server administrator to create your account."
      }
      footer={
        <>
          Already have a workspace? <Link href="/login">Sign in</Link>
        </>
      }
    >
      {emailEnabled && (
        <SignInForm
          next={appPath()}
          method="verify"
          submitLabel="Continue with email"
        />
      )}
    </AuthCard>
  );
}
