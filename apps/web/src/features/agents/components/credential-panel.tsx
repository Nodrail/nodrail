"use client";

import { useCallback, useState } from "react";
import { Card, CardActions } from "@/components/app/card";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { SecretReveal } from "@/components/app/secret-reveal";
import type { ActionResult } from "@/components/app/action-result";
import { Button } from "@/components/ui/button";
import type { CredentialDto, IssuedCredentialDto } from "@/contracts/v1/agents";
import { timeAgo } from "@/lib/time";
import { revokeCredentialAction, rotateCredentialAction } from "../actions";

/** The live credential's visible prefix and when it was made and last used. */
function CredentialLine({ live }: { live: CredentialDto | undefined }) {
  const lastUsed = live?.lastUsedAt
    ? `last used ${timeAgo(live.lastUsedAt)}`
    : "not used yet";
  return (
    <p
      key={live?.prefix ?? "none"}
      className="flex animate-in flex-wrap items-center gap-2.5 text-ui text-muted-foreground duration-200 fade-in-0"
    >
      {live ? (
        <>
          <code className="text-xs text-body">ndr_{live.prefix}_…</code>
          <span>
            Created {timeAgo(live.createdAt)} · {lastUsed}
          </span>
        </>
      ) : (
        <span>This installation has no working credential.</span>
      )}
    </p>
  );
}

export function CredentialPanel({
  workspace,
  installationId,
  installationName,
  credentials,
}: {
  workspace: string;
  installationId: string;
  installationName: string;
  credentials: CredentialDto[];
}) {
  const [issued, setIssued] = useState<IssuedCredentialDto | null>(null);
  const showIssued = useCallback(
    (result: Extract<ActionResult<IssuedCredentialDto>, { status: "ok" }>) => {
      if (result.data) setIssued(result.data);
    },
    [],
  );

  const live = credentials.find((credential) => !credential.revokedAt);
  const rotateLabel = live ? "Rotate" : "Create credential";

  return (
    <Card
      title="Credential"
      description="How this installation authenticates to Nodrail. It is not a provider credential."
    >
      <CredentialLine live={live} />
      {issued ? (
        <SecretReveal label="New credential" secret={issued.secret}>
          <Button
            type="button"
            variant="outline"
            onClick={() => setIssued(null)}
          >
            I&apos;ve saved it
          </Button>
        </SecretReveal>
      ) : null}
      <CardActions>
        <ConfirmDialog
          kicker="Credential"
          title={`${rotateLabel} for ${installationName}?`}
          triggerLabel={rotateLabel}
          triggerVariant="outline"
          confirmLabel={rotateLabel}
          confirmVariant="default"
          action={() => rotateCredentialAction(workspace, installationId)}
          onSuccess={showIssued}
        >
          <p>
            {live
              ? "The current secret stops working immediately. Update your integration with the new one. Waiting requests are not affected."
              : "A new secret is created and shown once."}
          </p>
        </ConfirmDialog>
        {live ? (
          <ConfirmDialog
            kicker="Credential"
            title={`Revoke the credential for ${installationName}?`}
            triggerLabel="Revoke"
            confirmLabel="Revoke credential"
            action={() => revokeCredentialAction(workspace, installationId)}
          >
            <p>
              The secret stops working and this installation&apos;s open
              requests are closed. Use this if it may have been exposed.
            </p>
          </ConfirmDialog>
        ) : null}
      </CardActions>
    </Card>
  );
}
