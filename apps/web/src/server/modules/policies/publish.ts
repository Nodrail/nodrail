import "server-only";
import type { PolicyFileResultDto } from "@/contracts/v1/policies";
import type { WorkspaceContext } from "@/server/db/context";
import { recordAudit } from "@/server/modules/audit";
import { pinPolicyContracts } from "@/server/modules/contracts/registry";
import { publishSnapshot } from "./index";
import { nothingToPublish, type VersionOrigin } from "./managed";
import type { plan } from "./rule-files";

/**
 * Publishing a planned policy as one new version: its contracts pinned, the
 * version written with where it came from, and audited.
 */

export const policyCounts = ({
  added,
  changed,
  removed,
}: Pick<
  Awaited<ReturnType<typeof plan>>,
  "added" | "changed" | "removed"
>) => ({
  added: added.length,
  changed: changed.length,
  removed: removed.length,
});

/** Publishes a plan with no issues as one new version, unless it changes nothing. */
export async function publishPlanned(
  context: WorkspaceContext,
  environmentId: string,
  planned: Awaited<ReturnType<typeof plan>>,
  origin: VersionOrigin = { managed: null, source: null },
): Promise<PolicyFileResultDto> {
  return (
    (await publishIfChanged(context, environmentId, planned, origin)) ?? {
      policyRevision: planned.revision,
      ...policyCounts(planned),
    }
  );
}

export async function publishIfChanged(
  context: WorkspaceContext,
  environmentId: string,
  planned: Awaited<ReturnType<typeof plan>>,
  origin: VersionOrigin,
): Promise<PolicyFileResultDto | null> {
  const counts = policyCounts(planned);
  if (await nothingToPublish(context, environmentId, counts, origin))
    return null;

  const revision = planned.revision + 1;
  if (planned.runPolicy?.receipts)
    await pinPolicyContracts(context, planned.runPolicy, planned.inputShapes);
  const versionId = await publishSnapshot(context, {
    environmentId,
    revision,
    carried: planned.carried,
    written: planned.written,
    runPolicy: planned.runPolicy,
    origin,
  });
  await recordAudit(context, {
    eventType: "policy.published",
    decisionCode: "rules_applied",
    environmentId,
    policyVersionId: versionId,
    payload: {
      subject: `${counts.added} added, ${counts.changed} changed, ${counts.removed} removed`,
      detail: `Policy set v${revision}`,
    },
  });
  return { policyRevision: revision, ...counts };
}
