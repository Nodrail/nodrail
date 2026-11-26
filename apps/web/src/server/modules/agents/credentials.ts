import "server-only";
import { randomBytes } from "node:crypto";
import type { IssuedCredentialDto } from "@/contracts/v1/agents";
import type { WorkspaceContext } from "@/server/db/context";
import { InstallationCredential } from "@/server/db/entities";
import { RUNTIME_SCOPES } from "@/server/db/runtime-scopes";
import type { RunPolicy } from "@/server/modules/runs/history";
import { digestSecret, newSecret } from "@/server/security/secrets";

const HOST_SCOPES = [
  "policy:read",
  "decisions:write",
  "reports:write-own",
  "heartbeat:write",
];

/** The secret exists only in this response. Only its digest is stored. */
export async function issueCredential(
  context: WorkspaceContext,
  installationId: string,
  scopes = RUNTIME_SCOPES,
): Promise<IssuedCredentialDto> {
  const prefix = randomBytes(6).toString("hex");
  const secret = newSecret();
  const id = await storeCredential(context, installationId, scopes, {
    prefix,
    digest: digestSecret(secret),
  });
  return { id, prefix, secret: `ndr_${prefix}_${secret}` };
}

/** Activates a host-generated secret without receiving the secret itself. */
export async function storeCredential(
  context: WorkspaceContext,
  installationId: string,
  scopes: string[],
  { prefix, digest }: { prefix: string; digest: string },
) {
  const credential = await context.manager.save(InstallationCredential, {
    workspaceId: context.workspaceId,
    installationId,
    publicPrefix: prefix,
    secretDigest: digest,
    scopes,
    createdBy: context.principal.userId,
  });
  return credential.id;
}

export async function closeCredential(
  context: WorkspaceContext,
  installationId: string,
) {
  const { manager, workspaceId, principal } = context;
  const [closed]: [{ id: string }[], number] = await manager.query(
    `UPDATE nodrail.installation_credentials
     SET revoked_at = clock_timestamp(), revoked_by = $3
     WHERE workspace_id = $1 AND installation_id = $2 AND revoked_at IS NULL
     RETURNING id`,
    [workspaceId, installationId, principal.userId],
  );
  return closed.length > 0;
}

/** Runtime accepts historical pins from the same project and environment. */
export async function supportedHostScopes(
  context: WorkspaceContext,
  { environmentId, projectId }: { environmentId: string; projectId: string },
) {
  const rows: Pick<RunPolicy, "gates" | "limits">[] =
    await context.manager.query(
      `SELECT run_policy->'gates' AS gates, run_policy->'limits' AS limits
       FROM nodrail.policy_versions
       WHERE workspace_id = $1 AND environment_id = $2
         AND managed_project_id = $3 AND source_digest IS NOT NULL
         AND run_policy IS NOT NULL`,
      [context.workspaceId, environmentId, projectId],
    );
  return [
    ...HOST_SCOPES,
    ...(rows.some(({ limits }) =>
      limits?.some(({ across }) => across === "environment"),
    )
      ? ["budgets:reserve"]
      : []),
    ...(rows.some(({ gates }) =>
      gates?.some((gate) => "evidence" in gate && gate.evidence?.length),
    )
      ? ["evidence:read"]
      : []),
  ];
}
