import "server-only";
import type { ReceivedSpans } from "@nodrail/policy-engine";
import type { z } from "zod";
import { CONTRACT_REPORTING_SCHEMA } from "@/contracts/v1/declared-contracts";
import { MAX_SPANS_PER_EXPORT } from "@/contracts/v1/inventory";
import {
  contractDecisionAttributes,
  contractRunEventAttributes,
  decisionAttributes,
  reportingResource,
  runEventAttributes,
} from "@/contracts/v1/reporting";
import { requireCapability, type WorkspaceContext } from "@/server/db/context";
import {
  keepObservation,
  observedTime,
  toReport,
  type ReportedProject,
} from "@/server/modules/inventory";
import { keepContractSpan } from "@/server/modules/contracts/ingest";
import { findEnvironment } from "@/server/modules/workspaces";

/**
 * What an installation reports (reporting contract v2), each span
 * as what it says it is: an observation for the inventory, a decision its
 * local hook made, or a step or action of a local run. The workspace, the
 * environment and the person come from the token, never from a span. A
 * decision or run event is kept once, by its span ids; none of it grants
 * or passes anything.
 */

export type IngestResult = { accepted: number; rejected: number };

type Span = ReceivedSpans["spans"][number];

type Event = {
  kind: "decision" | "run.event";
  machine: string | null;
  host: string;
  agent: string | null;
  decision: string | null;
  runEvent: string | null;
  run: string | null;
  step: string | null;
  tool: string | null;
  operation: string | null;
  policyRevision: string | null;
  details: Record<string, string | number | boolean>;
};

/** Only the keys the contract names, and only when set. */
const defined = (
  values: Record<string, string | number | boolean | undefined>,
) =>
  Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  ) as Record<string, string | number | boolean>;

/**
 * A decision span. Schema 3 adds the brief or input check the decision
 * followed; an older schema never carries one, and it is ignored if it does.
 */
function decisionOf(span: Span, schema: string): Event | null {
  const contracts = schema === CONTRACT_REPORTING_SCHEMA;
  const parsed = contracts
    ? contractDecisionAttributes.safeParse(span.attributes)
    : decisionAttributes.safeParse(span.attributes);
  if (!parsed.success) return null;
  const a: Partial<z.infer<typeof contractDecisionAttributes>> &
    z.infer<typeof decisionAttributes> = parsed.data;
  return {
    kind: "decision",
    machine: a["nodrail.machine"] ?? null,
    host: a["nodrail.host"],
    agent: a["nodrail.agent"] ?? null,
    decision: a["nodrail.decision"],
    runEvent: null,
    run: a["nodrail.run"] ?? null,
    step: a["nodrail.step"] ?? null,
    tool: a["nodrail.tool"] ?? null,
    operation: a["nodrail.operation"] ?? null,
    policyRevision: a["nodrail.policy.revision"] ?? null,
    details: defined({
      resourceKind: a["nodrail.resource.kind"],
      match: a["nodrail.match"],
      rule: a["nodrail.rule"],
      legacyRevision: a["nodrail.revision"],
      session: a["session.id"],
      toolCall: a["gen_ai.tool.call.id"],
      ...(contracts
        ? {
            briefState: a["nodrail.brief.state"],
            briefContract: a["nodrail.brief.contract"],
            inputState: a["nodrail.input.state"],
            inputContract: a["nodrail.input.contract"],
          }
        : {}),
    }),
  };
}

/**
 * A run event span. Schema 3 adds a declared receipt's state and contract;
 * an older schema never carries them, and they are ignored if it does.
 */
function runEventOf(span: Span, schema: string): Event | null {
  const contracts = schema === CONTRACT_REPORTING_SCHEMA;
  const parsed = (
    contracts ? contractRunEventAttributes : runEventAttributes
  ).safeParse(span.attributes);
  if (!parsed.success) return null;
  const a = parsed.data;
  return {
    kind: "run.event",
    machine: a["nodrail.machine"] ?? null,
    host: a["nodrail.host"],
    agent: a["nodrail.agent"],
    decision: null,
    runEvent: a["nodrail.run.event"],
    run: a["nodrail.run"],
    step: a["nodrail.step"] ?? null,
    tool: a["nodrail.tool"] ?? null,
    operation: a["nodrail.operation"] ?? null,
    policyRevision: null,
    details: defined({
      verdict: a["nodrail.verdict"],
      findings: a["nodrail.findings"],
      tokens: a["nodrail.usage.tokens"],
      usd: a["nodrail.usage.usd"],
      outcome: a["nodrail.outcome"],
      change: a["nodrail.change"],
      ...(contracts
        ? {
            receiptState: a["nodrail.receipt.state"],
            receiptContract: a["nodrail.receipt.contract"],
          }
        : {}),
    }),
  };
}

const ids = (span: Span) =>
  /^[0-9a-f]{32}$/.test(span.traceId) && /^[0-9a-f]{16}$/.test(span.spanId);

/** Kept once: a retry of the same span changes nothing. */
async function keepEvent(
  context: WorkspaceContext,
  where: { environmentId: string; project: ReportedProject },
  span: Span,
  event: Event & { occurredAt: Date },
) {
  await context.manager.query(
    `INSERT INTO nodrail.reported_events
       (workspace_id, environment_id, user_id, kind, trace_id, span_id,
        machine, project_id, project, host, agent, decision, run_event, run,
        step, tool, operation, policy_revision, details, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
             $15, $16, $17, $18, $19, $20)
     ON CONFLICT ON CONSTRAINT reported_events_once DO NOTHING`,
    [
      context.workspaceId,
      where.environmentId,
      context.principal.userId,
      event.kind,
      span.traceId,
      span.spanId,
      event.machine,
      where.project.id,
      where.project.name,
      event.host,
      event.agent,
      event.decision,
      event.runEvent,
      event.run,
      event.step,
      event.tool,
      event.operation,
      event.policyRevision,
      JSON.stringify(event.details),
      event.occurredAt,
    ],
  );
}

/** One span, kept as what it is; false when it isn't one the contract reads. */
async function keepSpan(
  context: WorkspaceContext,
  where: { environmentId: string; project: ReportedProject; schema: string },
  span: Span,
  now: number,
) {
  if (span.name === "nodrail.contract.event") {
    // Only a client that speaks schema 3 reports contracts.
    const at = observedTime(span, now);
    if (where.schema !== CONTRACT_REPORTING_SCHEMA || at === null || !ids(span))
      return false;
    return keepContractSpan(context, where, span, new Date(at));
  }
  if (span.name === "nodrail.observation") {
    const report = toReport(where.project, span, now);
    if (report)
      await keepObservation(
        context,
        {
          environmentId: where.environmentId,
          userId: context.principal.userId,
        },
        report,
      );
    return report !== null;
  }
  const event =
    span.name === "nodrail.decision"
      ? decisionOf(span, where.schema)
      : span.name === "nodrail.run.event"
        ? runEventOf(span, where.schema)
        : null;
  const at = observedTime(span, now);
  if (!event || at === null || !ids(span)) return false;
  await keepEvent(context, where, span, { ...event, occurredAt: new Date(at) });
  return true;
}

/**
 * Keeps each span an export carries as its sender's report; what the
 * contract doesn't read (another kind, a newer schema, a malformed span) is
 * counted as rejected, and the rest of the export is still kept.
 */
export async function ingestReports(
  context: WorkspaceContext,
  environmentSlug: string,
  exports: ReceivedSpans[],
): Promise<IngestResult> {
  requireCapability(context, "workspace:read");
  const environment = await findEnvironment(context, environmentSlug);
  const now = Date.now();
  const result: IngestResult = { accepted: 0, rejected: 0 };
  for (const { resource, spans } of exports) {
    const parsed = reportingResource.safeParse(resource);
    const where = parsed.success
      ? {
          environmentId: environment.id,
          schema: parsed.data["nodrail.schema"] ?? "1",
          project: {
            name: parsed.data["nodrail.project"],
            id: parsed.data["nodrail.project.id"] ?? null,
          },
        }
      : null;
    for (const span of spans) {
      const kept =
        where !== null &&
        result.accepted + result.rejected < MAX_SPANS_PER_EXPORT &&
        (await keepSpan(context, where, span, now));
      if (kept) result.accepted++;
      else result.rejected++;
    }
  }
  return result;
}
