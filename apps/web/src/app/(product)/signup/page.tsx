import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthCard } from "@/features/auth/components/auth-card";
import { SignInForm } from "@/features/auth/components/sign-in-form";
import { emailConfigured } from "@/server/notifications/mailer";
import { getPrincipal } from "@/server/auth/current";
import { safeNextPath } from "@/features/auth/next-path";
import { docsUrl } from "@/features/guidance/docs-url";
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

export default async function SignupPage({
  searchParams,
}: PageProps<"/signup">) {
  const next = safeNextPath((await searchParams).next);
  if (await getPrincipal()) redirect(next);
  const invited = next.startsWith("/invite/");
  const emailEnabled = emailConfigured();
  return (
    <AuthCard
      eyebrow="The open control plane for AI agent development"
      title={invited ? "Create an account to join" : "Start your workspace"}
      intro={
        emailEnabled
          ? invited
            ? "Verify your email to continue to your workspace invitation."
            : intro()
          : "Ask your server administrator to create your account."
      }
      footer={
        <>
          Already have an account?{" "}
          <Link href={`/login?next=${encodeURIComponent(next)}`}>Sign in</Link>
        </>
      }
    >
      {emailEnabled ? (
        <SignInForm
          next={next}
          method="verify"
          submitLabel="Continue with email"
        />
      ) : (
        <a
          className="text-ui underline"
          href={docsUrl("self-hosting#account-provisioning")}
        >
          Administrator account provisioning
        </a>
      )}
    </AuthCard>
  );
}
