import "server-only";
import { fingerprint } from "@nodrail/policy-engine/protocol";
import { parseReceipt } from "@nodrail/policy-engine/receipts";
import type { z } from "zod";
import { runInput, stepInput } from "@/contracts/v1/runtime";
import type {
  ReceiptContract,
  ReceiptReading,
} from "@/contracts/v1/shapes-engine";
import { AppError, parseInput, type RuntimeContext } from "@/server/db/context";
import { consumeStep } from "@/server/modules/billing/metering";
import {
  keepReceiptEvent,
  readDeclaredReceipt,
  receiptRecord,
  sameReading,
  usable,
  type Capture,
} from "@/server/modules/contracts/runtime-receipts";
import { callerStep, runtimeCaller } from "@/server/modules/runtime/caller";
import {
  pinnedRevision,
  requirePolicyOwnership,
} from "@/server/modules/runtime/policy-revision";
import { touch } from "@/server/modules/runtime/touch";
import {
  liveRunPolicy,
  liveRunPolicyIn,
  type Place,
  type ReceiptRecord,
} from "./history";

/** The next place in a run. Drawn after the run is locked, when it is. */
export const nextSeq = "nextval('nodrail.run_events')";

/**
 * The run this installation declares, created on first use and locked until
 * the call ends, so two decisions in one run never read the same history and
 * every event's place follows the order it committed in.
 */
async function lockRun(context: RuntimeContext, key: string) {
  const [row]: { id: string }[] = await context.manager.query(
    `INSERT INTO nodrail.runs (workspace_id, environment_id, installation_id, key)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (workspace_id, environment_id, installation_id, key) DO UPDATE
     SET last_activity_at = clock_timestamp()
     RETURNING id`,
    [context.workspaceId, context.environmentId, context.installationId, key],
  );
  if (!row) throw new AppError("BUSY");
  return row.id;
}

/**
 * The same run without holding it. Rules alone never read history, so
 * nothing needs to wait: the activity time moves only if no one else holds
 * the row, and they are moving it anyway.
 */
async function linkRun(context: RuntimeContext, key: string) {
  const { manager, workspaceId, environmentId, installationId } = context;
  const scope = [workspaceId, environmentId, installationId, key];
  const find = async () => {
    const [row]: { id: string }[] = await manager.query(
      `SELECT id FROM nodrail.runs
       WHERE workspace_id = $1 AND environment_id = $2 AND installation_id = $3
         AND key = $4`,
      scope,
    );
    return row?.id;
  };
  // Looked up first: an insert, even one that does nothing, waits for a
  // call that is moving the same run's activity time.
  let runId = await find();
  if (!runId) {
    await manager.query(
      `INSERT INTO nodrail.runs (workspace_id, environment_id, installation_id, key)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (workspace_id, environment_id, installation_id, key) DO NOTHING`,
      scope,
    );
    runId = await find();
  }
  if (!runId) throw new AppError("BUSY");
  await manager.query(
    `UPDATE nodrail.runs SET last_activity_at = clock_timestamp()
     WHERE id = (SELECT id FROM nodrail.runs WHERE workspace_id = $1 AND id = $2
                 FOR NO KEY UPDATE SKIP LOCKED)`,
    [workspaceId, runId],
  );
  return runId;
}

/**
 * A step belongs to the agent it was first recorded with, and to no other.
 * `counted` steps use the workspace's step allowance when first recorded:
 * those reported on their own. A step an action names is paid for by the
 * action.
 */
async function ensureStep(
  context: RuntimeContext,
  runId: string,
  step: { id: string; agent: string },
  counted = false,
) {
  const created: unknown[] = await context.manager.query(
    `INSERT INTO nodrail.run_steps
       (workspace_id, run_id, step_key, agent, installation_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (workspace_id, run_id, step_key) DO NOTHING
     RETURNING 1`,
    [context.workspaceId, runId, step.id, step.agent, context.installationId],
  );
  if (counted && created.length) await consumeStep(context);
  const [row]: {
    agent: string;
    installation_id: string;
    finished_at: Date | null;
    verdict: string | null;
    receipt: object;
  }[] = await context.manager.query(
    `SELECT agent, installation_id, finished_at, verdict, receipt
     FROM nodrail.run_steps
     WHERE workspace_id = $1 AND run_id = $2 AND step_key = $3`,
    [context.workspaceId, runId, step.id],
  );
  // Runs are the installation's own, so this holds; checked all the same.
  if (!row || row.installation_id !== context.installationId)
    throw new AppError("NOT_FOUND");
  if (row.agent !== step.agent) throw new AppError("INVALID_INPUT");
  return row;
}

/**
 * Enters the run an intent declares, and its step if it names one. The run
 * is locked only when decisions read its history (`lock`).
 */
export async function enterRun(
  context: RuntimeContext,
  run: z.infer<typeof runInput>,
  lock: boolean,
): Promise<Place> {
  const runId = await (lock ? lockRun : linkRun)(context, run.key);
  const step = run.step ?? null;
  if (step) await ensureStep(context, runId, step);
  return { runId, key: run.key, step };
}

type Input = z.infer<typeof stepInput>;
type Receipt = NonNullable<Input["receipt"]>;

/** What a finish stores, and for a declared receipt, how it was read. */
type Read = {
  verdict: string | null;
  receipt: {
    findings: string[];
    usage: { tokens?: number; usd?: number };
    contract?: ReceiptRecord;
  };
  declared: { contract: ReceiptContract; reading: ReceiptReading } | null;
};

/**
 * A hook sends the block as written; it is read here. An agent with a
 * declared receipt contract in the live policy is read against it by the
 * engine's reader; any other by the fixed parser, as before.
 */
function readReceipt(
  sent: Receipt | undefined,
  agent: string,
  contract: ReceiptContract | undefined,
  via: Capture,
): Read {
  if (contract) {
    const reading = readDeclaredReceipt(sent, contract, agent);
    const valid = reading.state === "valid";
    return {
      verdict: valid ? reading.verdict : null,
      receipt: {
        findings: [],
        usage: valid ? reading.usage : {},
        contract: receiptRecord(reading, contract, via),
      },
      declared: { contract, reading },
    };
  }
  const read = sent && "text" in sent ? parseReceipt(sent.text) : sent;
  return {
    verdict: read?.verdict ?? null,
    receipt: { findings: read?.findings ?? [], usage: read?.usage ?? {} },
    declared: null,
  };
}

/** What a finish answers: a declared receipt's state, and why it isn't usable. */
export type StepAnswer = {
  recorded: true;
  receipt?: { state: ReceiptReading["state"]; reason: string | null };
};

const answerOf = (read: Read): StepAnswer => {
  const record = read.receipt.contract;
  return record
    ? {
        recorded: true,
        receipt: { state: record.state, reason: record.reason },
      }
    : { recorded: true };
};

type Stored = { verdict: string | null; receipt: object };

const sameFinish = (first: Stored, read: Read) => {
  const stored = first.receipt as Read["receipt"];
  if (stored.contract && read.receipt.contract)
    return sameReading(stored.contract, read.receipt.contract);
  return (
    first.verdict === read.verdict &&
    fingerprint(first.receipt) === fingerprint(read.receipt)
  );
};

/**
 * Writes a finish: the first one, or one replacing a declared receipt that
 * wasn't usable (invalid or missing), so an agent whose hand-back was
 * refused can send it again. A usable finish is final. An UPDATE answers
 * with its rows and how many it changed.
 */
async function writeFinish(
  context: RuntimeContext,
  where: unknown[],
  read: Read,
  replace: boolean,
) {
  const [, written]: [unknown, number] = await context.manager.query(
    `UPDATE nodrail.run_steps
     SET finished_at = clock_timestamp(), finished_seq = ${nextSeq},
         verdict = $4, receipt = $5::jsonb
     WHERE workspace_id = $1 AND run_id = $2 AND step_key = $3
       AND ${
         replace
           ? `finished_at IS NOT NULL
              AND receipt->'contract'->>'state' IN ('invalid', 'missing')`
           : "finished_at IS NULL"
       }`,
    [...where, read.verdict, JSON.stringify(read.receipt)],
  );
  return written > 0;
}

/**
 * A step starting or finishing. Repeating an event changes nothing. Once a
 * step finished with a usable receipt, finishing it again with a different
 * one is refused, so that history never changes; the hand-back's dedupe
 * relies on it. A declared receipt's reading is answered, so a hook can
 * refuse a hand-back with its reason.
 */
async function runPolicyForStep(
  { context, refusal }: Awaited<ReturnType<typeof runtimeCaller>>,
  digest?: string,
) {
  if (refusal) throw new AppError("FORBIDDEN", refusal);
  await requirePolicyOwnership(context);
  const pinned = digest ? await pinnedRevision(context, digest) : undefined;
  if (context.enrollmentProjectId && !pinned) throw new AppError("NOT_FOUND");
  if (!digest) return liveRunPolicyIn(context, context.environmentId);
  return liveRunPolicy(pinned?.run_policy);
}

export async function recordStep(
  context: RuntimeContext,
  rawInput: unknown,
): Promise<StepAnswer> {
  const input = parseInput(stepInput, rawInput);
  const caller = await runtimeCaller(context, input.agent);
  context = caller.context;
  input.step = callerStep(caller, input.step);
  await touch(context);
  const policy = await runPolicyForStep(caller, input.policy_digest);
  const place = await enterRun(context, input.run, policy !== null);
  const current = await ensureStep(context, place.runId, input.step, true);
  const where = [context.workspaceId, place.runId, input.step.id];
  if (input.event === "started") {
    // A step reported finished before it was seen starting stays finished.
    await context.manager.query(
      `UPDATE nodrail.run_steps
       SET started_at = clock_timestamp(), started_seq = ${nextSeq}
       WHERE workspace_id = $1 AND run_id = $2 AND step_key = $3
         AND started_at IS NULL AND finished_at IS NULL`,
      where,
    );
    return { recorded: true };
  }
  const { agent } = input.step;
  const read = readReceipt(
    input.receipt,
    agent,
    policy?.receipts?.[agent],
    input.via ?? "stop",
  );
  // Only the first finish writes; a repeat, even a concurrent one, compares.
  let written =
    !current.finished_at && (await writeFinish(context, where, read, false));
  if (!written) {
    const first = await ensureStep(context, place.runId, input.step);
    if (!sameFinish(first, read)) {
      const stored = (first.receipt as Read["receipt"]).contract;
      written =
        read.declared !== null &&
        stored !== undefined &&
        !usable(stored) &&
        (await writeFinish(context, where, read, true));
      if (!written) throw new AppError("IDEMPOTENCY_CONFLICT");
    }
  }
  if (written && read.declared && read.receipt.contract)
    await keepReceiptEvent(
      context,
      { runId: place.runId, step: input.step.id, agent },
      { ...read.declared, record: read.receipt.contract },
    );
  return answerOf(read);
}
