import type { Metadata } from "next";
import { focusRing } from "@/components/app/styles";
import { cn } from "@/lib/utils";
import { AuthCard } from "@/features/auth/components/auth-card";
import { SignOutForm } from "@/features/auth/components/sign-out-form";
import { DeleteAccountDialog } from "@/features/settings/components/delete-account-dialog";
import { CreateWorkspaceForm } from "@/features/workspaces/components/create-workspace-form";
import { requirePrincipal } from "@/server/auth/current";
import { accountEmail } from "@/server/modules/account";

export const metadata: Metadata = { title: "Create a workspace" };

export default async function NewWorkspacePage() {
  const email = await accountEmail(await requirePrincipal());
  return (
    <AuthCard
      eyebrow="The open control plane for AI agent development"
      title="Name your workspace"
      intro="Usually your team or project. You can change it later."
      footer={
        <>
          <SignOutForm variant="ghost" />
          {/* Rarely wanted here, so out of the way of creating a workspace. */}
          <details className="group mt-2">
            <summary
              className={cn(
                "mx-auto w-fit cursor-pointer rounded-sm text-xs font-semibold text-body",
                focusRing,
              )}
            >
              Account options
            </summary>
            <div className="mt-2 group-open:animate-in group-open:fade-in-0">
              <DeleteAccountDialog email={email} />
            </div>
          </details>
        </>
      }
    >
      <CreateWorkspaceForm />
    </AuthCard>
  );
}
