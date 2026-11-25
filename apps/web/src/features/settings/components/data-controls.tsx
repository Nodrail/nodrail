"use client";

import { Card, CardActions } from "@/components/app/card";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { FormField } from "@/components/app/form-field";
import { Button, buttonVariants } from "@/components/ui/button";
import { ConsentSettingsButton } from "@nodrail/web-shared/analytics/consent";
import { site } from "@nodrail/web-shared/site";
import { archiveWorkspaceAction } from "../actions";
import { DeleteAccountDialog } from "./delete-account-dialog";
import { appPath } from "@/lib/product-path";

/** The workspace's own data: a download for admins, archiving for the owner. */
export function WorkspaceDataCard({
  workspace,
  workspaceName,
  canExport,
  isOwner,
}: {
  workspace: string;
  workspaceName: string;
  canExport: boolean;
  isOwner: boolean;
}) {
  return (
    <Card
      title="Workspace data"
      description="Download what this workspace holds, or close it for everyone."
    >
      <CardActions>
        {canExport ? (
          <Button asChild variant="outline">
            <a href={appPath(workspace, "export")} download>
              Download workspace data
            </a>
          </Button>
        ) : null}
        {isOwner ? (
          <ConfirmDialog
            kicker="Archive workspace"
            title={`Archive ${workspaceName}?`}
            triggerLabel="Archive workspace"
            confirmLabel="Archive workspace"
            action={archiveWorkspaceAction.bind(null, workspace)}
          >
            <p>
              Everyone loses access and its agents stop being able to reach
              Nodrail. Their covered actions stay blocked.
            </p>
            <p className="font-semibold">
              You can&apos;t undo this: an archived workspace can&apos;t be
              reopened from Nodrail. Archiving doesn&apos;t delete its records.
            </p>
            {canExport ? (
              <p>
                Want a copy first?{" "}
                <a
                  href={appPath(workspace, "export")}
                  download
                  className="font-semibold text-forest underline"
                >
                  Download workspace data
                </a>
                .
              </p>
            ) : null}
            <FormField
              id="archive-confirm"
              name="confirm"
              label="Type the name of this workspace to confirm"
              autoComplete="off"
              required
            />
          </ConfirmDialog>
        ) : null}
      </CardActions>
    </Card>
  );
}

/** What is yours: cookie choices, the privacy policy and deleting your account. */
export function PersonalDataCard({ email }: { email: string }) {
  return (
    <Card
      title="Your data"
      description="Nodrail keeps your name, your email and what you decided. Deleting your account removes your name and email; past decisions stay in each workspace's history without them."
    >
      <CardActions>
        <ConsentSettingsButton
          label="Cookie settings"
          className={buttonVariants({ variant: "outline" })}
        />
        <Button asChild variant="ghost">
          <a href={`${site.url}/privacy`}>Privacy policy</a>
        </Button>
        <DeleteAccountDialog email={email} />
      </CardActions>
    </Card>
  );
}
