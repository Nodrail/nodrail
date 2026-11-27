import type { LimitState } from "@nodrail/policy-engine/ledger";
import { z } from "zod";
import {
  idempotencyKey,
  policyDigest,
  reportInput,
  runInput,
  runtimeAgent,
  submitActionInput,
} from "./runtime";

const budgetId = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/);

export const reserveSharedInput = z
  .object({
    agent: runtimeAgent,
    call_fingerprint: idempotencyKey,
    policy_digest: policyDigest,
    calls: z
      .array(submitActionInput.pick({ tool: true, operation: true }))
      .min(1)
      .max(100),
    // Wire IDs from the exact locked source. Reservation still checks all server-side coverings.
    budget_ids: z.array(budgetId).max(500).optional(),
    // Only amounts of declared admission budgets, never the raw tool input.
    amounts: z
      .record(budgetId, z.number().int().min(0).max(Number.MAX_SAFE_INTEGER))
      .optional(),
    run: runInput.optional(),
  })
  .strict();

export const startSharedInput = reserveSharedInput
  .pick({ call_fingerprint: true, policy_digest: true, agent: true })
  .extend({ claim_id: z.uuid() })
  .strict();

export const settleSharedInput = reportInput
  .pick({
    outcome: true,
    measured: true,
    tokens: true,
  })
  .extend({
    call_fingerprint: idempotencyKey,
    policy_digest: policyDigest,
    agent: runtimeAgent,
  })
  .strict();

export type SharedBudgetRequest = z.infer<typeof reserveSharedInput>;
export type SharedBudgetReply = {
  expires_at: string | null;
  limits: LimitState[];
  reason?: string;
};
