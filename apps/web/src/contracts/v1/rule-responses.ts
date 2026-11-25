import { z } from "zod";
import { condition, effects, resourceScope } from "./policies";

const count = z.number().int().nonnegative();
const text = z.string();
const instant = z.iso.datetime({ offset: true });

const rule = z.object({
  logical_rule_id: z.uuid(),
  rule_revision: count,
  name: text,
  effect: z.enum(effects),
  agent_key: text.nullable(),
  installation_name: text.nullable(),
  tool_key: text,
  operation_key: text,
  resource: resourceScope,
  conditions: z.array(condition),
  expires_at: instant.nullable(),
  status: z.enum(["active", "expired", "revoked"]),
  updated_at: instant,
  updated_by: text,
});

export const ruleDetail = rule.extend({
  history: z.array(
    z.object({
      revision: count,
      name: text,
      summary: text,
      updated_at: instant,
      updated_by: text,
    }),
  ),
  revoked: z.object({ at: instant, by: text }).nullable(),
});

const gate = z.object({
  id: text,
  name: text,
  tool_key: text,
  operation_key: text,
  resource: resourceScope,
  agent_key: text.nullable(),
  requires: z.array(
    z
      .object({
        agent: text,
        verdicts: z.array(text),
        since: z.array(text),
      })
      .loose(),
  ),
  effect: z.literal("deny"),
});

const budget = z.object({
  id: text,
  name: text,
  agent: text.nullable(),
  per: z.enum(["step", "run"]),
  metric: z.enum(["tool_calls", "tokens", "usd"]),
  limit: z.number(),
  warn_at: z.number().nullable(),
  effect: z.literal("deny"),
});

export const rules = z.object({
  rules: z.array(rule),
  policy_revision: count,
  policy: z.object({
    revision: count,
    gates: z.array(gate),
    budgets: z.array(budget),
  }),
  last_matched: z.record(z.uuid(), instant),
});
