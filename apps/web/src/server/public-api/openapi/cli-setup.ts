import { z } from "zod";
import { cliExchange, cliStart } from "@/contracts/v1/cli-login";
import {
  enrollmentBody,
  enrollmentReconcileBody,
  projectAccess,
  projectApplyBody,
} from "@/contracts/v1/project-apply";
import { environmentQuery } from "@/contracts/v1/public-api";
import { operation } from "./operation";

const loginPath = "/cli/login";
const browserPath = `${loginPath}/approve/{challenge}`;
const ok = z.object({ ok: z.literal(true) });

export const cliSetupOperations = [
  operation("post", `${loginPath}/start`, "Start CLI browser sign-in", {
    auth: "public",
    body: cliStart,
    result: ok,
  }),
  operation("get", browserPath, "Open the CLI browser sign-in confirmation", {
    auth: "cliBrowser",
    html: true,
  }),
  operation("post", browserPath, "Confirm CLI browser sign-in", {
    auth: "cliBrowser",
    html: true,
    headers: { Origin: z.url() },
  }),
  operation(
    "post",
    `${loginPath}/exchange`,
    "Exchange CLI proof for a session once it is confirmed",
    {
      auth: "public",
      body: cliExchange,
      result: z.union([
        z.object({ pending: z.literal(true) }),
        z.object({ token: z.string(), expires_at: z.iso.datetime() }),
      ]),
    },
  ),
  operation("post", "/cli/logout", "Revoke a CLI session", {
    auth: "cliSession",
    result: ok,
  }),
  operation(
    "get",
    "/cli/workspaces",
    "List workspaces visible to this CLI login",
    {
      auth: "cliSession",
    },
  ),
  operation(
    "post",
    "/projects/enrollment/reconcile",
    "Cancel a pending enrollment generation or revoke it if it activated",
    {
      auth: { management: "rules:write", bearerOnly: true },
      query: environmentQuery,
      body: enrollmentReconcileBody,
      result: z.object({ status: z.enum(["never_activated", "revoked"]) }),
    },
  ),
  operation(
    "post",
    "/projects/enrollment",
    "Check a credential for the selected machine and project",
    {
      auth: { management: "read", bearerOnly: true },
      query: environmentQuery,
      body: enrollmentBody,
      result: z.object({
        valid: z.boolean(),
        fresh: z.boolean(),
        installation_id: z.uuid().nullable(),
        current_credential: z.string().nullable(),
      }),
    },
  ),
  operation(
    "post",
    "/projects/access",
    "Grant project apply access or explicitly bind an agent",
    {
      auth: { management: "agents:manage", bearerOnly: true },
      query: environmentQuery,
      body: projectAccess,
      result: ok,
    },
  ),
  operation(
    "post",
    "/projects/apply",
    "Reconcile agents, publish a project lock, and enroll the machine",
    {
      auth: { management: "rules:write", bearerOnly: true },
      query: environmentQuery,
      body: projectApplyBody,
      result: z.object({
        published: z
          .object({
            policy_revision: z.number(),
            added: z.number(),
            changed: z.number(),
            removed: z.number(),
          })
          .nullable(),
        enrollment: z
          .object({
            installation_id: z.uuid(),
            credential: z.string().nullable(),
            credential_generation: z.string().nullable().optional(),
          })
          .nullable(),
      }),
    },
  ),
];
