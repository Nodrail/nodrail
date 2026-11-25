import { z } from "zod";
import { idempotencyKey, policyDigest, submitActionInput } from "./runtime";

/**
 * `POST /runtime/decisions`: calls the hook decided on its host with the
 * engine, for Cloud to record where its own decisions are. Cloud
 * never decides them again: no rule is evaluated, no permit issued and no
 * budget reserved for them. A host only allows or denies.
 */

/** Most decisions one request may carry; the body stays under 64 KB too. */
export const MAX_HOST_DECISIONS = 100;
export const MAX_HOST_REASON = 1000;

/** What the host told the agent's runtime. */
export const hostVerdict = z.enum(["allow", "deny"]);
export type HostVerdict = z.infer<typeof hostVerdict>;

/** The verdict as a row's `initial_evaluation`, as for Cloud's own rows. */
export const evaluationOfVerdict = {
  allow: "ready",
  deny: "denied",
} as const satisfies Record<HostVerdict, string>;

/**
 * One decision: the call as the hook described it (the same descriptor,
 * redaction and size limits as a submitted action), what it decided, the
 * rule that matched and why, when, with which policy file, and in which
 * run. `idempotency_key` is deterministic on the host, so a retry is the
 * same row.
 */
export const hostDecisionInput = submitActionInput
  .extend({
    idempotency_key: idempotencyKey,
    verdict: hostVerdict,
    rule: z
      .object({
        id: z.string().min(1).max(128),
        name: z.string().min(1).max(200).optional(),
      })
      .strict()
      .nullable()
      .optional(),
    reason: z.string().max(MAX_HOST_REASON).optional(),
    decided_at: z.iso.datetime({ offset: true }),
    policy_digest: policyDigest.nullable(),
  })
  .strict();
export type HostDecisionInput = z.infer<typeof hostDecisionInput>;

/** Each item is read on its own, so one bad item never refuses the rest. */
export const hostDecisionsInput = z
  .object({
    decisions: z.array(z.unknown()).min(1).max(MAX_HOST_DECISIONS),
  })
  .strict();

/** Each item's answer, in order: its row, or why it wasn't recorded. */
export type HostDecisionResult =
  | { key: string; action_id: string }
  | { key: string | null; error: { code: string } };

export type HostDecisionsDto = { results: HostDecisionResult[] };
