import { z } from "zod";
import { projectPreviewBody } from "@/contracts/v1/project-apply";
import { insights } from "@/contracts/v1/insights-responses";
import { reconcileInput, reservationsQuery } from "@/contracts/v1/budgets";
import { projectionRevisionInput } from "@/contracts/v1/declared-contracts";
import {
  createVerifierInput,
  evidenceStatusQuery,
  evidenceSubmitInput,
} from "@/contracts/v1/evidence";
import { publishRevisionInput } from "@/contracts/v1/inventory";
import {
  policyFilePreview,
  policyFilePublished,
  rulesFile,
} from "@/contracts/v1/management-responses";
import * as input from "@/contracts/v1/public-api";
import { operation } from "./operation";

const query = input.environmentQuery;
const read = { management: "read" } as const;
const write = { management: "rules:write" } as const;
const reporting = { management: "inventory:write", bearerOnly: true } as const;

export const existingOperations = [
  operation(
    "get",
    "/me",
    "Describe the management credential and its effective scopes",
    {
      auth: { ...read, bearerOnly: true },
      query,
    },
  ),
  operation("get", "/activity", "List activity events", {
    auth: read,
    query: input.activityApiQuery,
  }),
  operation("get", "/activity/{id}", "Read an activity event", {
    auth: read,
    query,
  }),
  operation(
    "post",
    "/activity/export",
    "Export matching activity events and record the export",
    { auth: read, query, body: input.activityExportBody },
  ),
  operation("get", "/runs", "List runs", {
    auth: read,
    query: input.runsApiQuery,
  }),
  operation("get", "/runs/{id}", "Read a run timeline", { auth: read, query }),
  operation("get", "/insights", "Read decision and rule metrics", {
    auth: read,
    query: input.insightsQuery,
    result: insights,
  }),
  operation("get", "/rules", "Read the rules file", {
    auth: read,
    query,
    result: rulesFile,
  }),
  operation("get", "/rules/live", "Read metadata for the live policy version", {
    auth: read,
    query,
  }),
  operation("post", "/rules/preview", "Preview a rules file", {
    auth: write,
    query,
    body: projectPreviewBody,
    result: policyFilePreview,
  }),
  operation("post", "/rules/publish", "Publish the previewed rules file", {
    auth: write,
    query,
    body: input.publishBody,
    result: policyFilePublished,
  }),
  operation("get", "/contracts", "List a project's contract bindings", {
    auth: read,
    query: input.contractsQuery,
  }),
  operation(
    "get",
    "/contracts/{digest}",
    "Read a contract or projection revision",
    { auth: read, query: input.contractQuery },
  ),
  operation(
    "get",
    "/contracts/diff",
    "Compare two revisions of a project's contracts",
    { auth: read, query: input.contractDiffQuery },
  ),
  operation(
    "post",
    "/contracts/projections",
    "Register a reporting projection",
    { auth: reporting, query, body: projectionRevisionInput },
  ),
  operation("get", "/contract-events", "List declared contract events", {
    auth: read,
    query: input.contractEventsApiQuery,
  }),
  operation("get", "/contract-events/{id}", "Read a declared contract event", {
    auth: read,
    query,
  }),
  operation(
    "get",
    "/workspace-revisions",
    "Read a project's intended revision",
    { auth: read, query: input.revisionQuery },
  ),
  operation(
    "post",
    "/workspace-revisions",
    "Publish a project's intended revision",
    { auth: write, query, body: publishRevisionInput },
  ),
  operation("get", "/inventory", "Read the team's reported inventory", {
    auth: read,
    query,
  }),
  operation(
    "get",
    "/reported/decisions",
    "List decisions reported by local hooks",
    { auth: read, query },
  ),
  operation("get", "/reported/runs", "List runs reported by local hooks", {
    auth: read,
    query,
  }),
  operation("get", "/verifiers", "List evidence verifiers", {
    auth: read,
    query,
  }),
  operation("post", "/verifiers", "Create an evidence verifier", {
    auth: write,
    query,
    body: createVerifierInput,
  }),
  operation("post", "/verifiers/{id}/revoke", "Revoke an evidence verifier", {
    auth: write,
    query,
    body: z.unknown(),
  }),
  operation(
    "get",
    "/evidence/status",
    "Check a published evidence requirement",
    { auth: read, query: evidenceStatusQuery },
  ),
  operation("post", "/evidence", "Submit verified CI evidence", {
    auth: "github",
    body: evidenceSubmitInput,
  }),
  operation("get", "/budgets", "Read budget status", { auth: read, query }),
  operation("get", "/budgets/reservations", "List budget reservations", {
    auth: read,
    query: reservationsQuery,
  }),
  operation(
    "post",
    "/budgets/reservations/{id}/reconcile",
    "Reconcile a budget reservation",
    { auth: write, query, body: reconcileInput },
  ),
  operation("post", "/otlp/v1/traces", "Submit an OTLP trace export", {
    auth: reporting,
    query,
    body: z.object({ resourceSpans: z.array(z.unknown()) }),
    protobuf: true,
  }),
];
