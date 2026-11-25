import { z } from "zod";
import { effects } from "./policies";

const count = z.number().int().nonnegative();
const text = z.string();
const id = z.uuid();
const instant = z.iso.datetime({ offset: true });
const share = z.object({ count, of: count });

const ruleUsage = z.object({
  logical_rule_id: id,
  name: text,
  effect: z.enum(effects),
  matches: count,
  last_matched_at: instant.nullable(),
});

export const insights = z.object({
  days: z.literal([7, 30, 90]),
  decisions: z.object({
    actions: count,
    allowed: count,
    denied: count,
    no_rule: count,
  }),
  rules: z.object({
    top: z.array(ruleUsage),
    unused: z.array(ruleUsage),
    newer: count,
    active_rules: count,
    decided: share,
  }),
});

const run = z.object({ id, key: text });
const spend = z.object({ usd: z.number(), tokens: count });
export const insightsReport = z.object({
  gates: z.array(
    z.object({
      id: text,
      name: text,
      checked: count,
      held: count,
      first_pass: share,
      missing: z.array(z.object({ label: text, count })),
    }),
  ),
  budgets: z.array(
    z.object({ id: text, name: text, hits: count, runs: z.array(run) }),
  ),
  agents: z.array(
    z.object({
      agent: text,
      steps: count,
      verdicts: z.array(z.object({ verdict: text, count })),
      without_receipt: count,
      back_steps: count,
      contradicted_passes: count,
      spend,
    }),
  ),
  runs: z.object({
    count,
    median_steps: z.number().nullable(),
    without_hold: share,
    rework_loops: count,
    with_rework: count,
    spend,
  }),
  checks: z.array(
    z.object({ agent: text, runs: count, first_try: count, eventually: count }),
  ),
  top_runs: z.array(run.extend({ steps: count, rework_loops: count, spend })),
});

const installation = { agent_key: text, installation_name: text };
export const health = z.object({
  agents: z.object({ connected: count, reporting: count, paused: count }),
  silent: z.array(
    z.object({ ...installation, last_seen_at: instant.nullable() }),
  ),
  paused: z.array(
    z.object({
      agent_key: text,
      paused_at: instant.nullable(),
      paused_by: text.nullable(),
    }),
  ),
  stalled_steps: z.array(
    z.object({
      run_id: id,
      run_key: text,
      step_key: text,
      step_agent: text,
      since: instant,
      last_activity_at: instant,
    }),
  ),
  uncovered: z.array(
    z.object({ ...installation, actions: count, uncovered: count }),
  ),
  mismatched: z.array(
    z.object({
      agent_key: text,
      tool_key: text,
      operation_key: text,
      reported_at: instant,
    }),
  ),
});
