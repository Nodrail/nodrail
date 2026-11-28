import "server-only";
import { fingerprint } from "@nodrail/sdk/protocol";
import { z } from "zod";
import {
  submitContractEventInput,
  type SafeValidationIssue,
  type SubmitContractEventInput,
} from "@/contracts/v1/contract-events";
import type { ContractSurface } from "@/contracts/v1/declared-contracts";
import { resolvedShape } from "@/contracts/v1/resolved-shape";
import { validateValue } from "@/contracts/v1/shapes-engine";
import {
  AppError,
  parseInput,
  parseRows,
  type RuntimeContext,
} from "@/server/db/context";
import { touch } from "@/server/modules/runtime/touch";
import {
  keepAuthoritative,
  keptFrom,
  pinnedProjection,
  type ServerReading,
} from "./authoritative";

/**
 * For briefs, connection inputs and results on the Cloud runtime path, the
 * installation submits the full value. The server uses the engine to validate
 * it against the contract a publish pinned,
 * and keeps an authoritative event with only its projection. A result's
 * execution (what the provider did) and delivery stay apart from whether
 * it conformed. Other surfaces are refused until their wave enforces them.
 */

/** What this path takes now; receipts come with `/steps`. */
const SUBMITTED: readonly ContractSurface[] = [
  "brief",
  "tool_input",
  "tool_result",
];

export type SubmittedEventDto = {
  id: string;
  validation: "valid" | "invalid" | null;
  /** Declared paths and codes only, never a value. */
  issues: SafeValidationIssue[];
  issue_count: number;
};

const revisionRow = z.object({ name: z.string(), schema: resolvedShape });

async function pinnedRevision(
  context: RuntimeContext,
  input: SubmitContractEventInput,
) {
  const [row] = parseRows(
    revisionRow,
    await context.manager.query(
      `SELECT name, schema FROM nodrail.contract_revisions
       WHERE workspace_id = $1 AND surface = $2 AND digest = $3`,
      [context.workspaceId, input.surface, input.contract_digest],
    ),
  );
  // Only a published contract can be validated against; Cloud never takes
  // an installation's word for what the contract says.
  if (!row) throw new AppError("NOT_FOUND");
  return row;
}

/** This installation's run by its key, if it recorded one. */
async function runOf(context: RuntimeContext, key: string | undefined) {
  if (!key) return null;
  const [row]: { id: string }[] = await context.manager.query(
    `SELECT id FROM nodrail.runs
     WHERE workspace_id = $1 AND environment_id = $2 AND installation_id = $3
       AND key = $4`,
    [context.workspaceId, context.environmentId, context.installationId, key],
  );
  return row?.id ?? null;
}

/** An action digest binds the event to one of this installation's actions. */
async function checkAction(
  context: RuntimeContext,
  digest: string | undefined,
) {
  if (!digest) return;
  const [row]: unknown[] = await context.manager.query(
    `SELECT 1 FROM nodrail.action_requests
     WHERE workspace_id = $1 AND installation_id = $2 AND action_digest = $3
     LIMIT 1`,
    [context.workspaceId, context.installationId, digest],
  );
  if (!row) throw new AppError("NOT_FOUND");
}

function readingOf(
  input: SubmitContractEventInput,
  shape: z.infer<typeof resolvedShape>,
): ServerReading {
  if (input.capture !== "captured") return { state: input.capture };
  const value = input.payload!;
  const issues = validateValue(shape, value);
  return issues.length
    ? { state: "invalid", issues }
    : { state: "valid", value, findings: null };
}

const existingRow = z.object({
  id: z.uuid(),
  body_digest: z.string().nullable(),
  validation: z.enum(["valid", "invalid"]).nullable(),
  issues: z.array(z.custom<SafeValidationIssue>()),
  issue_count: z.number(),
});

/**
 * A retry with the same key answers as the first; any other submission under
 * it is refused. The fingerprint covers every field the installation sent,
 * the payload included. An event kept before fingerprints were has none, so
 * nothing shows a retry of it is the same: that is refused too.
 */
async function alreadyKept(
  context: RuntimeContext,
  input: SubmitContractEventInput,
  bodyDigest: string,
): Promise<SubmittedEventDto> {
  const [row] = parseRows(
    existingRow,
    await context.manager.query(
      `SELECT id, body_digest, validation, issues, issue_count
       FROM nodrail.contract_events
       WHERE workspace_id = $1 AND installation_id = $2
         AND idempotency_key = $3`,
      [context.workspaceId, context.installationId, input.idempotency_key],
    ),
  );
  if (!row || row.body_digest !== bodyDigest)
    throw new AppError("IDEMPOTENCY_CONFLICT");
  return {
    id: row.id,
    validation: row.validation,
    issues: row.issues,
    issue_count: row.issue_count,
  };
}

export async function submitContractEvent(
  context: RuntimeContext,
  rawInput: unknown,
): Promise<SubmittedEventDto> {
  const input = parseInput(submitContractEventInput, rawInput);
  if (!SUBMITTED.includes(input.surface)) throw new AppError("INVALID_INPUT");
  await touch(context);
  const revision = await pinnedRevision(context, input);
  await checkAction(context, input.action_digest);
  const projection = await pinnedProjection(
    context,
    input.surface,
    input.contract_digest,
    revision.schema,
  );
  const reading = readingOf(input, revision.schema);
  // Only a valid result can be handed on, whatever the runtime says.
  if (input.delivered === true && reading.state !== "valid")
    throw new AppError("INVALID_INPUT");
  const kept = keptFrom(reading, projection);
  const bodyDigest = fingerprint(input);
  const id = await keepAuthoritative(context, {
    surface: input.surface,
    producerClass: "runtime-observed",
    contract: { name: revision.name, digest: input.contract_digest },
    idempotencyKey: input.idempotency_key,
    runId: await runOf(context, input.run?.key),
    agent: null,
    step: input.step ?? null,
    actionDigest: input.action_digest ?? null,
    kept,
    execution: input.execution ?? null,
    delivered: input.delivered ?? null,
    bodyDigest,
  });
  if (!id) return alreadyKept(context, input, bodyDigest);
  return {
    id,
    validation: kept.validation,
    issues: kept.issues,
    issue_count: kept.issueCount,
  };
}
