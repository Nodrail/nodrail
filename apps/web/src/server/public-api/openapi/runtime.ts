import { z } from "zod";
import { submitContractEventInput } from "@/contracts/v1/contract-events";
import { evidenceStatusQuery } from "@/contracts/v1/evidence";
import {
  reserveSharedInput,
  settleSharedInput,
  startSharedInput,
} from "@/contracts/v1/runtime-budgets";
import {
  hostDecisionsInput,
  hostDecisionsResult,
} from "@/contracts/v1/runtime-decisions";
import {
  heartbeatInput,
  idempotencyKey,
  permitInput,
  policyDigest,
  reportInput,
  runtimeAgent,
  stepInput,
  submitActionInput,
} from "@/contracts/v1/runtime";
import { hostObservationInput } from "@/contracts/v1/runtime-inventory";
import type { RuntimeScope } from "@/server/db/context";
import { operation, type Operation } from "./operation";

const runtime = (
  method: Operation["method"],
  path: string,
  summary: string,
  {
    scope,
    ...schemas
  }: Omit<Parameters<typeof operation>[3], "auth"> & {
    scope: RuntimeScope;
  },
) =>
  operation(method, `/runtime${path}`, summary, {
    auth: { runtime: scope },
    ...schemas,
  });

export const runtimeOperations = [
  runtime("get", "/actions", "Find an action by its idempotency key", {
    scope: "actions:read-own",
    query: z.object({ idempotency_key: idempotencyKey }),
  }),
  runtime("post", "/actions", "Submit a host action", {
    scope: "actions:submit",
    headers: { "Idempotency-Key": idempotencyKey },
    body: submitActionInput,
  }),
  runtime("get", "/actions/{id}", "Read the status of a host action", {
    scope: "actions:read-own",
  }),
  runtime(
    "post",
    "/actions/{id}/permit",
    "Request a permit for a host action",
    { scope: "permits:request", body: permitInput },
  ),
  runtime(
    "post",
    "/actions/{id}/reports",
    "Report the outcome of a host action",
    { scope: "reports:write-own", body: reportInput },
  ),
  runtime("post", "/budgets/reserve", "Reserve shared budget capacity", {
    scope: "budgets:reserve",
    body: reserveSharedInput,
  }),
  runtime(
    "post",
    "/budgets/start",
    "Claim a shared budget lease for execution",
    {
      scope: "budgets:reserve",
      body: startSharedInput,
    },
  ),
  runtime(
    "post",
    "/budgets/settle",
    "Report the outcome of a shared budget lease",
    {
      scope: "reports:write-own",
      body: settleSharedInput,
    },
  ),
  runtime("post", "/contract-events", "Submit a contract event", {
    scope: "actions:submit",
    body: submitContractEventInput,
  }),
  runtime(
    "post",
    "/decisions",
    "Record a batch of decisions made on the host",
    {
      scope: "decisions:write",
      body: hostDecisionsInput,
      result: hostDecisionsResult,
    },
  ),
  runtime(
    "get",
    "/evidence/status",
    "Check an evidence requirement for the host's environment",
    {
      scope: "evidence:read",
      query: evidenceStatusQuery.omit({ environment: true }),
    },
  ),
  runtime("post", "/heartbeat", "Record an installation heartbeat", {
    scope: "heartbeat:write",
    body: heartbeatInput,
  }),
  runtime(
    "get",
    "/access",
    "Check fresh access for a host-asserted caller. A machine pause blocks every caller.",
    {
      scope: "policy:read",
      query: z.object({
        agent: runtimeAgent,
        call: idempotencyKey
          .optional()
          .describe("The key that will be used to report this decision"),
        policy_digest: policyDigest
          .optional()
          .describe("Required for enrolled hosts"),
        workspace_revision: policyDigest
          .optional()
          .describe("Required for enrolled hosts"),
      }),
      result: z.object({
        paused: z.boolean(),
        agent: z.string(),
        admission_id: z.string().optional(),
        project_id: z.uuid().nullable(),
        workspace: z.string(),
        environment: z.string(),
        paused_agents: z.array(z.string()).optional(),
        reason: z.string().optional(),
      }),
    },
  ),
  runtime("post", "/inventory", "Record an enrolled host observation", {
    scope: "heartbeat:write",
    body: hostObservationInput,
  }),
  runtime(
    "post",
    "/disconnect",
    "Revoke the calling machine enrollment credential",
    {
      scope: "policy:read",
      body: z.object({}),
      result: z.object({ revoked: z.boolean() }),
    },
  ),
  runtime("get", "/identity", "Read the calling installation's identity", {
    scope: "actions:read-own",
  }),
  runtime("get", "/policy", "Read the policy for the host's environment", {
    scope: "policy:read",
  }),
  runtime("post", "/steps", "Record a run step", {
    scope: "actions:submit",
    body: stepInput,
  }),
];
