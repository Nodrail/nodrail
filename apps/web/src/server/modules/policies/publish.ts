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

/** Publishes a plan with no issues as one new version, unless it changes nothing. */
export async function publishPlanned(
  context: WorkspaceContext,
  environmentId: string,
  planned: Awaited<ReturnType<typeof plan>>,
  origin: VersionOrigin = { managed: null, source: null },
): Promise<PolicyFileResultDto> {
  const counts = {
    added: planned.added.length,
    changed: planned.changed.length,
    removed: planned.removed.length,
  };
  if (await nothingToPublish(context, environmentId, counts, origin))
    return { policyRevision: planned.revision, ...counts };

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
