import { z } from "zod";
import { health, insightsReport } from "@/contracts/v1/insights-responses";
import { ruleDetail, rules } from "@/contracts/v1/rule-responses";
import * as input from "@/contracts/v1/management";
import * as output from "@/contracts/v1/management-responses";
import { createWorkspaceInput } from "@/contracts/v1/workspaces";
import { inviteInput } from "@/contracts/v1/team";
import { environmentQuery, insightsQuery } from "@/contracts/v1/public-api";
import { operation } from "./operation";

const read = { management: "read" } as const;
const agents = { management: "agents:manage" } as const;
const members = { management: "members:manage" } as const;
const settings = { management: "workspace:settings" } as const;
const policies = { management: "rules:write" } as const;
const workspaceSession = "workspaceSession";
const query = environmentQuery;
const ok = input.okResponse;

const workspaces = [
  operation("get", "/workspaces", "List your workspaces", {
    auth: "session",
    query: input.noInput,
    result: output.pageOf(output.workspaceSummary),
  }),
  operation("post", "/workspaces", "Create a workspace and its environments", {
    auth: "session",
    body: createWorkspaceInput,
    result: output.workspaceCreated,
  }),
  operation("get", "/workspace", "Read the selected workspace", {
    auth: read,
    query,
    result: output.workspace,
  }),
  operation("get", "/environments", "List the workspace environments", {
    auth: read,
    query,
    result: output.pageOf(output.environment),
  }),
  operation("get", "/workspace/settings", "Read workspace settings", {
    auth: read,
    query,
    result: output.workspaceSettings,
  }),
  operation(
    "patch",
    "/workspace/settings",
    "Rename the workspace or change its default environment",
    {
      auth: settings,
      query,
      body: input.workspaceSettingsBody,
      result: output.workspaceSettings,
    },
  ),
  operation("post", "/workspace/archive", "Archive a workspace as its owner", {
    auth: workspaceSession,
    query,
    body: input.archiveWorkspaceBody,
    result: ok,
  }),
  operation("get", "/workspace/export", "Export workspace data", {
    auth: settings,
    query,
  }),
];

const runtimes = [
  operation("get", "/agents", "List agent installations in an environment", {
    auth: read,
    query: input.agentListQuery,
    result: output.agents,
  }),
  operation(
    "post",
    "/agents",
    "Connect an agent and issue its first runtime credential",
    {
      auth: agents,
      query,
      body: input.connectAgentBody,
      result: output.connectedAgent,
    },
  ),
  operation("get", "/agent-options", "List agent options for filters", {
    auth: read,
    query,
    result: output.agentOptions,
  }),
  operation(
    "get",
    "/agents/{key}",
    "Read agent details and visible credential metadata",
    { auth: read, query, result: output.agentDetail },
  ),
  operation(
    "get",
    "/agents/{key}/check-in",
    "Read the agent's check-in and setup checks",
    { auth: read, query, result: output.agentCheckIn },
  ),
  operation("patch", "/agents/{key}/access", "Pause or resume an agent", {
    auth: agents,
    query,
    body: input.agentAccessBody,
    result: output.accessChanged,
  }),
  operation(
    "post",
    "/installations/{id}/credentials/rotate",
    "Replace or issue an installation credential",
    {
      auth: agents,
      query,
      body: input.noInput,
      result: output.issuedCredential,
    },
  ),
  operation(
    "post",
    "/installations/{id}/credentials/revoke",
    "Revoke an installation credential",
    {
      auth: agents,
      query,
      body: input.noInput,
      result: output.credentialRevoked,
    },
  ),
];

const team = [
  operation("get", "/team", "List team members and visible invites", {
    auth: read,
    query,
    result: output.team,
  }),
  operation("patch", "/team/members/{id}", "Change a member's role", {
    auth: members,
    query,
    body: input.memberRoleBody,
    result: output.memberChanged,
  }),
  operation("delete", "/team/members/{id}", "Remove a team member", {
    auth: members,
    query,
    result: output.memberChanged,
  }),
  operation("post", "/team/ownership", "Transfer workspace ownership", {
    auth: workspaceSession,
    query,
    body: input.memberBody,
    result: ok,
  }),
  operation("get", "/team/invites", "List pending invites", {
    auth: members,
    query,
    result: output.pageOf(output.invite),
  }),
  operation("post", "/team/invites", "Issue a one-time invite token", {
    auth: members,
    query,
    body: inviteInput,
    result: output.inviteIssued,
  }),
  operation("post", "/team/invites/{id}/revoke", "Revoke a pending invite", {
    auth: members,
    query,
    body: input.noInput,
    result: ok,
  }),
  operation("get", "/team/invite", "View an invite as its recipient", {
    auth: "session",
    query: input.inviteTokenQuery,
    result: output.inviteView,
  }),
  operation("post", "/team/invite", "Accept an invite as its recipient", {
    auth: "session",
    body: input.inviteTokenQuery,
    result: output.inviteAccepted,
  }),
  operation("get", "/agents/{key}/members", "Read agent assignments", {
    auth: members,
    query,
    result: output.agentPeople,
  }),
  operation("post", "/agents/{key}/members", "Assign a member to an agent", {
    auth: members,
    query,
    body: input.memberBody,
    result: ok,
  }),
  operation(
    "delete",
    "/agents/{key}/members/{id}",
    "Remove an agent assignment",
    { auth: members, query, result: output.memberChanged },
  ),
];

const tokens = [
  operation("get", "/tokens", "List personal access tokens", {
    auth: workspaceSession,
    query,
    result: output.tokenList,
  }),
  operation("post", "/tokens", "Create a personal access token", {
    auth: workspaceSession,
    query,
    body: input.createTokenBody,
    result: output.tokenIssued,
  }),
  operation("post", "/tokens/{id}/revoke", "Revoke a personal access token", {
    auth: workspaceSession,
    query,
    body: input.noInput,
    result: ok,
  }),
];

const derived = [
  operation("get", "/overview", "Read overview counts and recent decisions", {
    auth: read,
    query,
  }),
  operation(
    "get",
    "/insights/report",
    "Read gate, budget, and team run metrics",
    { auth: read, query: insightsQuery, result: insightsReport },
  ),
  operation("get", "/insights/health", "Read the health of agents and runs", {
    auth: read,
    query,
    result: health,
  }),
  operation(
    "get",
    "/rules/entries",
    "List rules, gates, budgets and last match times",
    { auth: read, query, result: rules },
  ),
  operation(
    "get",
    "/rules/entries/{id}",
    "Read a rule and its revision history",
    { auth: read, query, result: ruleDetail },
  ),
  operation(
    "get",
    "/rules/suggestions",
    "List recorded names for policy authoring",
    { auth: read, query, result: output.policySuggestions },
  ),
  operation("get", "/rules/budget-usage", "Read usage for policy budgets", {
    auth: read,
    query,
    result: output.budgetUsage,
  }),
  operation(
    "post",
    "/rules/impact",
    "Preview the impact of a proposed policy entry",
    {
      auth: policies,
      query,
      body: input.policyImpactBody,
      result: output.policyImpact,
    },
  ),
];

export const managementOperations = [
  ...workspaces,
  ...runtimes,
  ...team,
  ...tokens,
  ...derived,
  operation("get", "/session/csrf", "Get a CSRF token for session writes", {
    auth: "session",
    headers: { "X-Nodrail-CSRF": z.literal("fetch") },
    result: output.csrfResponse,
  }),
];
