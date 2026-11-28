import type { Descriptor } from "@nodrail/sdk";
import { z } from "zod";

/** The action a request describes, as every read of it needs it. */
export const actionColumns = {
  tool_key: z.string(),
  operation_key: z.string(),
  resource_kind: z.string(),
  resource_id: z.string(),
  params_safe: z.record(z.string(), z.unknown()),
};

type ActionRow = {
  agent_id: string;
  installation_id: string;
  tool_key: string;
  operation_key: string;
  resource_kind: string;
  resource_id: string;
  params_safe: Record<string, unknown>;
};

/** A stored request as the policy engine reads it when it decides. */
export const descriptorOf = (row: ActionRow): Descriptor => ({
  agentId: row.agent_id,
  installationId: row.installation_id,
  toolKey: row.tool_key,
  operationKey: row.operation_key,
  resourceKind: row.resource_kind,
  resourceId: row.resource_id,
  params: row.params_safe,
});
