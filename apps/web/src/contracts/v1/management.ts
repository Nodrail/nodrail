import { z } from "zod";
import { connectAgentInput } from "./agents";
import { apiTokenExpiries, createApiTokenInput } from "./api-tokens";
import { changeRoleInput, workspaceSettingsInput } from "./team";
import { environmentQuery } from "./public-api";

export const noInput = z.strictObject({});

export const agentListQuery = environmentQuery.extend({
  cursor: z.string().min(1).max(200).optional(),
});

export const connectAgentBody = z.strictObject({
  agent_key: connectAgentInput.shape.agentKey,
  adapter_key: connectAgentInput.shape.adapterKey,
  description: z.string().max(200).optional(),
});

export const memberRoleBody = changeRoleInput.pick({ role: true });
export const memberBody = z.strictObject({ user_id: z.uuid() });

export const workspaceSettingsBody = z.strictObject({
  name: workspaceSettingsInput.shape.name,
  default_environment: workspaceSettingsInput.shape.defaultEnvironment,
});

export const archiveWorkspaceBody = z.strictObject({
  confirmation: z.string().max(120),
});

export const createTokenBody = z.strictObject({
  name: createApiTokenInput.shape.name,
  scopes: createApiTokenInput.shape.scopes,
  expires_in_days: z.literal(apiTokenExpiries),
});

export const inviteTokenQuery = z.strictObject({
  token: z.string().regex(/^ndi_[A-Za-z0-9_-]{43}$/),
});

export const policyImpactBody = z.strictObject({
  kind: z.enum(["rule", "gate", "budget"]),
  id: z.string().min(1).max(128).nullable(),
  entry: z.unknown().nonoptional(),
});

export const okResponse = z.strictObject({ ok: z.literal(true) });

export const agentAccessBody = z.strictObject({
  status: z.enum(["active", "paused"]),
});
