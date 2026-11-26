import { z } from "zod";
import { capabilities, roles } from "./access";
import { adapters } from "./agents";
import { apiTokenScopes } from "./api-tokens";

const id = z.uuid();
const text = z.string();
const instant = z.iso.datetime({ offset: true });
const count = z.number().int().nonnegative();
const role = z.enum(roles);

export const pageOf = <Item extends z.ZodType>(item: Item) =>
  z.object({ items: z.array(item), next_cursor: text.nullable() });

export const workspaceSummary = z.object({ id, name: text, slug: text, role });
export const workspaceSettings = workspaceSummary
  .omit({ role: true })
  .extend({ default_environment_id: id.nullable() });
export const workspace = workspaceSettings.extend({
  role,
  is_owner: z.boolean(),
  capabilities: z.array(z.enum(capabilities)),
});
export const workspaceCreated = z.object({ workspace_id: id, slug: text });
export const environment = z.object({ id, slug: text, name: text });
export const rulesFile = z.object({ environment: text, yaml: text });

export const issuedCredential = z.object({ id, prefix: text, secret: text });
const credential = issuedCredential.omit({ secret: true }).extend({
  created_at: instant,
  last_used_at: instant.nullable(),
  revoked_at: instant.nullable(),
});
export const agentStatus = z.enum(["active", "paused"]);
export const accessChanged = z.object({ status: agentStatus });
const agentAccess = accessChanged.extend({
  paused_at: instant.nullable(),
  paused_by: text.nullable(),
});
const installation = z.object({
  disconnected: z.boolean(),
  machine_key: text.nullable(),
  machine_paused: z.boolean(),
  id,
  name: text,
  environment: environment.omit({ id: true }),
  adapter_key: text,
  adapter_version: text.nullable(),
  compatibility: z.enum(["unverified", "verified"]),
  reporting: z.enum(["reporting", "stale", "never_reported"]),
  last_seen_at: instant.nullable(),
});
const agent = z.object({
  project: id.nullable(),
  project_name: text.nullable(),
  key: text,
  description: text.nullable(),
  access: agentAccess,
  tools: z.array(text),
});
export const agents = pageOf(
  agent.extend({
    installation,
    installations: z.array(installation),
  }),
).extend({
  summary: z.object({ connected: count, reporting: count, paused: count }),
});
export const agentDetail = agent.extend({
  installations: z.array(
    installation.extend({ credentials: z.array(credential).optional() }),
  ),
  observed_actions: z.array(
    z.object({
      installation_name: text,
      tool_key: text,
      operation_key: text,
      resource_kind: text,
      resource: text,
      outcome: z.enum([
        "allowed_by_rule",
        "denied_by_rule",
        "unknown_blocked",
        "observed_only",
      ]),
      attempts: count,
      last_seen_at: instant,
    }),
  ),
});
export const agentOptions = pageOf(
  z.object({ key: text, installation_name: text.nullable() }),
);
export const connectedAgent = z.object({
  agent_key: text,
  installation_name: text,
  adapter_key: z.enum(adapters.map(({ key }) => key)),
  credential: issuedCredential,
});
export const credentialRevoked = z.object({ revoked: z.boolean() });
export const agentCheckIn = z.object({
  last_seen_at: instant.nullable(),
  checks: z.object({
    allowed: z.boolean(),
    blocked: z.boolean(),
    denied: z.boolean(),
  }),
});

const tokenScope = z.enum(apiTokenScopes);
const token = z.object({
  id,
  name: text,
  prefix: text,
  scopes: z.array(tokenScope),
  created_at: instant,
  expires_at: instant.nullable(),
  last_used_at: instant.nullable(),
  revoked_at: instant.nullable(),
  owner: text,
  mine: z.boolean(),
});
export const tokenList = z.object({
  tokens: z.array(token),
  grantable: z.array(tokenScope),
  sees_everyone: z.boolean(),
});
export const tokenIssued = z.object({ token, secret: text });

export const invite = z.object({
  id,
  email: text,
  role,
  invited_by: text,
  expires_at: instant,
  expired: z.boolean(),
});
export const inviteIssued = z.object({ token: text });
export const inviteAccepted = z.object({ slug: text });
export const inviteView = z.discriminatedUnion("status", [
  z.object({ status: z.literal("unavailable") }),
  z.object({ status: z.literal("wrong_email"), workspace: text }),
  z.object({
    status: z.literal("already_member"),
    workspace: text,
    slug: text,
  }),
  z.object({
    status: z.literal("open"),
    workspace: text,
    role,
    invited_by: text,
  }),
]);
export const memberChanged = z.object({ changed: z.boolean() });
const person = z.object({ user_id: id, name: text, role });
export const agentPeople = z.object({
  assigned: z.array(person),
  available: z.array(person),
});
export const team = z.object({
  members: z.array(
    person.extend({
      email: text.nullable(),
      is_owner: z.boolean(),
      is_you: z.boolean(),
      assigned_agents: count.nullable(),
      can_make_owner: z.boolean(),
    }),
  ),
  invites: z.array(invite).nullable(),
  assignable_roles: z.array(role),
});

export const policyImpact = z
  .object({
    days: count,
    actions: count,
    sampled: z.boolean(),
    matched: count,
    changed: count,
    runs: count,
    without_run: count,
  })
  .nullable();

export const policySuggestions = z.object({
  operations: z.array(text),
  resources: z.array(z.object({ kind: text, values: z.array(text) })),
  step_agents: z.array(text),
  verdicts: z.array(text),
});

export const budgetUsage = z.record(
  text,
  z.object({
    peak: count.nullable(),
    runs: count,
    held: count,
  }),
);

const policyFileIssue = z.object({
  line: count,
  column: count,
  message: text,
});
export const policyFilePreview = z.object({
  pins_current: z.boolean().optional(),
  catalog_removed: z.array(text).optional(),
  agent_changes: z
    .object({
      added: z.array(text),
      changed: z.array(text),
      removed: z.array(text),
    })
    .optional(),
  publishes_policy: z.boolean().optional(),
  workspace_lock_current: z.boolean().optional(),
  policy_counts: z
    .object({ added: count, changed: count, removed: count })
    .optional(),
  takeover: z
    .object({
      project_id: z.uuid(),
      hosts: z.array(z.object({ id: z.uuid(), name: text })),
    })
    .nullable()
    .optional(),
  issues: z.array(policyFileIssue),
  warnings: z.array(policyFileIssue),
  policy_revision: count,
  file_digest: text.describe(
    "Digest bound to the YAML and its preview environment.",
  ),
  added: z.array(text),
  changed: z.array(text),
  removed: z.array(text),
  unchanged: count,
});
export const policyFilePublished = z.object({
  policy_revision: count,
  added: count,
  changed: count,
  removed: count,
});
export const csrfResponse = z.object({
  token: text.regex(/^[A-Za-z0-9_-]{43}$/),
});
