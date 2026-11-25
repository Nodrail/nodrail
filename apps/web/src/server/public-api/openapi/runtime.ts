import { z } from "zod";
import { submitContractEventInput } from "@/contracts/v1/contract-events";
import { evidenceStatusQuery } from "@/contracts/v1/evidence";
import {
  reserveSharedInput,
  settleSharedInput,
  startSharedInput,
} from "@/contracts/v1/runtime-budgets";
import { hostDecisionsInput } from "@/contracts/v1/runtime-decisions";
import {
  heartbeatInput,
  idempotencyKey,
  permitInput,
  reportInput,
  stepInput,
  submitActionInput,
} from "@/contracts/v1/runtime";
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
    { scope: "decisions:write", body: hostDecisionsInput },
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
