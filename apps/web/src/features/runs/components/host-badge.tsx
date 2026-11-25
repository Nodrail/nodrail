import { StatusBadge } from "@/components/app/status-badge";
import { shortDigest, type DecidedOnHostDto } from "@/contracts/v1/runs";

/**
 * A call the hook decided on its host: Nodrail recorded it and never
 * decided it again. The short digest names the policy file it decided with.
 */
export function HostBadge({ host }: { host: DecidedOnHostDto | undefined }) {
  if (!host) return null;
  const { policyDigest, policySkew } = host;
  return (
    <span data-slot="decided-on-host" className="ml-1 inline-flex gap-1">
      <StatusBadge tone="neutral">Decided on host</StatusBadge>
      {policySkew ? (
        <small title="This digest differed from the published policy when the decision was reported">
          Policy skew
        </small>
      ) : null}
      {policyDigest ? (
        <small title={`Policy file SHA-256 ${policyDigest}`}>
          policy <code>{shortDigest(policyDigest)}</code>
        </small>
      ) : null}
    </span>
  );
}
