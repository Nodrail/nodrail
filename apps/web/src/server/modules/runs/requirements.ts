import "server-only";
import type { EntityManager } from "typeorm";
import {
  hasContracts,
  requirementMet,
  type ContractsDocument,
  type PolicyDocument,
  type Requirement,
  type RunContext,
  type SimulationResult,
} from "@nodrail/policy-engine";
import {
  explainRequirement,
  explainRunShortfall,
  type ContractCheckDto,
} from "@/contracts/v1/contract-explain";
import type { RequirementStatusDto } from "@/contracts/v1/runs";
import type {
  EvidenceReason,
  EvidenceStatusDto,
} from "@/contracts/v1/evidence";
import {
  matchWhere,
  satisfiesAuthority,
  type CompiledCondition,
  type ProducerClass,
} from "@/contracts/v1/shapes-engine";
import { stepReceiptEvent } from "@/server/modules/contracts/runtime-receipts";

type Finished = Extract<
  RunContext["events"][number],
  { type: "step.finished" }
>;

/** The agent's latest finished step in the run. */
function lastFinished(agent: string, run: RunContext | null) {
  const finished = run?.events.findLast(
    (event) => event.type === "step.finished" && event.agent === agent,
  );
  return finished?.type === "step.finished" ? finished : null;
}

/**
 * For a requirement on a declared receipt (C01): why it is met or not, at
 * path level, from the agent's latest receipt. When that receipt meets it
 * but the engine says the run doesn't, the run is why: the work changed
 * after the step began, or the revision it reviewed is unknown.
 */
function contractCheck(
  document: ContractsDocument,
  requirement: Requirement,
  finished: Finished | null,
  met: boolean,
): ContractCheckDto | undefined {
  const contract = document.receipts[requirement.agent];
  if (!requirement.contract || !contract) return undefined;
  const event =
    finished?.receipt && stepReceiptEvent(finished, finished.receipt, contract);
  const check = explainRequirement(
    {
      agent: requirement.agent,
      verdicts: requirement.verdicts,
      where: requirement.where ?? [],
      authority: requirement.authority ?? "agent-reported",
      contractDigest: requirement.contract,
      // Cloud doesn't see the work's revision; the engine judges `subject`.
      subjectRevision: null,
    },
    event || null,
  );
  if (met || !check.met) return check;
  return explainRunShortfall(
    requirement,
    check,
    requirement.subject === "revision",
  );
}

/**
 * Every requirement of the gate that decided, as the run stood: met or not
 * (judged as the engine judges it), what its agent last reported, and for
 * a declared receipt, the path-level reason. Kept with the hold so a
 * reviewer sees "qa reported fail", not only the rule. Undefined unless a
 * gate decided.
 */
export function gateRequirements(
  document: PolicyDocument,
  result: SimulationResult,
  run: RunContext | null,
): RequirementStatusDto[] | undefined {
  if (result.reason !== "gate" || document.version === 1) return undefined;
  const gate = document.gates.find(({ id }) => id === result.matchedRuleId);
  if (!gate) return undefined;
  const checkers = new Set(gate.requires.map(({ agent }) => agent));
  return gate.requires.map((requirement: Requirement) => {
    const met =
      run !== null && requirementMet(requirement, run.events, checkers);
    const finished = lastFinished(requirement.agent, run);
    const check = hasContracts(document)
      ? contractCheck(document, requirement, finished, met)
      : undefined;
    return {
      ...requirement,
      met,
      reported: finished
        ? { verdict: finished.verdict, at: finished.at }
        : null,
      ...(check ? { check } : {}),
    };
  });
}

/** A gate requirement on evidence, as a published revision pinned it. */
export type EvidenceNeed = {
  evidence: string;
  authority: ProducerClass;
  where: CompiledCondition[];
  /** The binding's contract in that revision. */
  contractDigest: string;
  /** The verifiers that binding names. */
  verifiers: string[];
  /** Runtime reads are limited to verifiers in the project pin. */
  projectScoped?: boolean;
};

type LatestEvidence = {
  id: string;
  producer_class: ProducerClass;
  contract_digest: string;
  validation: "valid" | "invalid" | null;
  authorized_value: Record<string, unknown> | null;
  received_at: Date;
  verifier: string;
  revoked_at: Date | null;
};

/**
 * Whether evidence meets a requirement for one subject, checked
 * in the design's order, first failure first: the subject is known; an
 * event exists for it (the last received decides, by `seq`); its producer
 * class reaches the authority; the revision's binding names its verifier;
 * that verifier isn't revoked (retroactively); it was validated
 * against the pinned contract; it is valid; `where` holds on its value.
 *
 * Only verifier events are read: a reported row, or an installation's,
 * never satisfies a Cloud evaluation.
 */
export async function evidenceShortfall(
  scope: { manager: EntityManager; workspaceId: string },
  environmentIds: string[],
  need: EvidenceNeed,
  subject: string | null,
): Promise<EvidenceStatusDto> {
  const status = (
    reason: EvidenceReason,
    row?: LatestEvidence,
  ): EvidenceStatusDto => ({
    met: reason === "met",
    reason_code: reason,
    event_id: row?.id ?? null,
    verifier: row
      ? {
          name: row.verifier,
          revoked_at: row.revoked_at?.toISOString() ?? null,
        }
      : null,
    received_at: row?.received_at.toISOString() ?? null,
  });
  if (!subject) return status("subject_unknown");
  const [row]: LatestEvidence[] = await scope.manager.query(
    `SELECT e.id, e.producer_class, e.contract_digest, e.validation,
            e.authorized_value, e.received_at, v.name AS verifier, v.revoked_at
     FROM nodrail.contract_events e
     JOIN nodrail.evidence_verifiers v
       ON v.workspace_id = e.workspace_id AND v.id = e.verifier_id
     WHERE e.workspace_id = $1 AND e.environment_id = ANY($2::uuid[])
       AND e.evidence = $3 AND e.subject_revision = $4
       AND e.authority = 'authoritative'
       AND ($5::text[] IS NULL OR (v.name = ANY($5) AND e.contract_digest = $6))
     ORDER BY e.seq DESC
     LIMIT 1`,
    [
      scope.workspaceId,
      environmentIds,
      need.evidence,
      subject,
      need.projectScoped ? need.verifiers : null,
      need.contractDigest,
    ],
  );
  if (!row) return status("no_event");
  if (!satisfiesAuthority(row.producer_class, need.authority))
    return status("authority", row);
  if (!need.verifiers.includes(row.verifier))
    return status("producer_not_allowed", row);
  if (row.revoked_at) return status("verifier_revoked", row);
  if (row.contract_digest !== need.contractDigest)
    return status("contract_mismatch", row);
  if (row.validation !== "valid") return status("invalid", row);
  if (!matchWhere(need.where, row.authorized_value ?? {}))
    return status("where_unmet", row);
  return status("met", row);
}
