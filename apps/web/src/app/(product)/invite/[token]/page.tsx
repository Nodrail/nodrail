import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { AuthCard } from "@/features/auth/components/auth-card";
import { SignOutForm } from "@/features/auth/components/sign-out-form";
import { roleLabels } from "@/features/shell/navigation";
import { AcceptInviteForm } from "@/features/team/components/accept-invite-form";
import { getPrincipal } from "@/server/auth/current";
import { viewInvite } from "@/server/modules/team/invites";
import { appPath } from "@/lib/product-path";

export const metadata: Metadata = {
  title: "Join a workspace",
  referrer: "no-referrer",
};

export default async function InvitePage({
  params,
}: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const principal = await getPrincipal();
  if (!principal)
    redirect(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);
  const invite = await viewInvite(principal, token);

  switch (invite.status) {
    case "open":
      return (
        <AuthCard
          eyebrow="Invitation"
          title={`Join ${invite.workspace}`}
          intro={`${invite.invitedBy} invited you as ${roleLabels[invite.role]}.`}
        >
          <AcceptInviteForm token={token} workspace={invite.workspace} />
        </AuthCard>
      );
    case "already_member":
      return (
        <AuthCard
          eyebrow="Invitation"
          title="You're already on this team"
          intro={`You are a member of ${invite.workspace}.`}
        >
          <Button asChild size="lg" className="w-full">
            <Link href={appPath(invite.slug)}>Open {invite.workspace}</Link>
          </Button>
        </AuthCard>
      );
    case "wrong_email":
      return (
        <AuthCard
          eyebrow="Invitation"
          title="This invite is for another address"
          intro={`Sign out, then open the link again using the email address invited to ${invite.workspace}.`}
        >
          <SignOutForm />
        </AuthCard>
      );
    default:
      return (
        <AuthCard
          eyebrow="Invitation"
          title="This invite is no longer available"
          intro="It may have expired or been used. Ask your teammate for a new one."
        >
          <Button asChild size="lg" className="w-full">
            <Link href={appPath()}>Go to Nodrail</Link>
          </Button>
        </AuthCard>
      );
  }
}
