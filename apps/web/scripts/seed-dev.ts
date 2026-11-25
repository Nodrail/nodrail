// Local sample data for the console. Refuses anything but local services.
import { randomBytes, randomUUID } from "node:crypto";
import { DataSource, type EntityManager } from "typeorm";
import {
  ActionRequest,
  ActivePolicy,
  Agent,
  AgentMember,
  AuditEvent,
  ClientReport,
  Environment,
  Installation,
  InstallationCredential,
  ObservedPermission,
  PolicyRule,
  User,
  Workspace,
  WorkspaceInvite,
  WorkspaceMembership,
} from "../src/server/db/entities";
import { dataSourceOptions } from "../src/server/db/options";
import { provisionWorkspace } from "../src/server/db/provisioning";
import { LoginAccount } from "../src/server/db/auth-entities";
import type { Role } from "../src/contracts/v1/access";
import { REQUEST_TTL_MINUTES } from "../src/contracts/v1/requests";
import { INVITE_TTL_DAYS } from "../src/contracts/v1/team";

const databaseUrl =
  "postgres://postgres:nodrail_local_only@127.0.0.1:54329/nodrail_dev";
const people: { email: string; name: string; role: Role; owner?: boolean }[] = [
  {
    email: "dev@nodrail.test",
    name: "Jordan Davis",
    role: "admin",
    owner: true,
  },
  { email: "alex@nodrail.test", name: "Alex Morgan", role: "viewer" },
  { email: "maya@nodrail.test", name: "Maya Chen", role: "policy_manager" },
  { email: "sam@nodrail.test", name: "Sam Rivera", role: "viewer" },
];

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);

/** The mockup's agents, with each state backed by data that could really exist. */
const sampleAgents = [
  {
    key: "support-agent",
    description: "Customer support",
    adapterKey: "claude-code-hook",
    lastSeen: 2,
    assignees: ["alex@nodrail.test", "sam@nodrail.test"],
    observed: [
      [
        "github",
        "issues.delete",
        "issue",
        "acme/support#482",
        "unknown_blocked",
      ],
      [
        "github",
        "issues.list",
        "repository",
        "acme/support",
        "allowed_by_rule",
      ],
      ["linear", "issues.get", "team", "Support", "allowed_by_rule"],
      [
        "slack",
        "channels.archive",
        "channel",
        "#support-old",
        "unknown_blocked",
      ],
    ],
    pending: ["github", "issues.delete", "issue", "acme/support#482"],
    pendingParams: {
      issue: 482,
      repository: "acme/support",
      labels: ["resolved"],
    },
  },
  {
    key: "research-agent",
    description: "Customer research",
    adapterKey: "custom-sdk",
    lastSeen: 8,
    assignees: [],
    observed: [
      ["postgres", "contacts.read", "schema", "research", "allowed_by_rule"],
      ["postgres", "contacts.export", "schema", "crm", "denied_by_rule"],
    ],
    pending: ["postgres", "contacts.export", "schema", "crm"],
    pendingParams: {
      schema: "crm",
      row_count: 47,
      destination: "s3://acme-research",
    },
  },
  {
    key: "billing-assistant",
    description: "Billing support",
    adapterKey: "custom-sdk",
    lastSeen: 19,
    assignees: ["alex@nodrail.test"],
    observed: [
      ["stripe", "refunds.create", "invoice", "INV-2048", "denied_by_rule"],
      ["stripe", "invoices.get", "invoice", "INV-2048", "allowed_by_rule"],
    ],
    pending: ["stripe", "refunds.create", "invoice", "INV-2048"],
    pendingParams: { invoice: "INV-2048", amount: 48, currency: "USD" },
  },
  {
    key: "docs-helper",
    description: "Documentation",
    adapterKey: "custom-sdk",
    lastSeen: 180,
    assignees: [],
    pausedBy: "maya@nodrail.test",
    observed: [
      ["notion", "pages.search", "workspace", "Docs", "observed_only"],
      ["github", "issues.list", "repository", "acme/docs", "observed_only"],
    ],
    pending: null,
  },
] as const;

/** Every "Allowed by rule" above has a real rule behind it. */
const sampleRules = [
  [
    "Support read access",
    "support-agent",
    "github",
    "issues.list",
    "repository",
    "allow",
    { match: "exact", value: "acme/support" },
  ],
  [
    "Support tickets in Linear",
    "support-agent",
    "linear",
    "issues.get",
    "team",
    "allow",
    { match: "exact", value: "Support" },
  ],
  [
    "Never delete repositories",
    null,
    "github",
    "repositories.delete",
    "repository",
    "deny",
    { match: "any" },
  ],
  [
    "No contact exports",
    "research-agent",
    "postgres",
    "contacts.export",
    "schema",
    "deny",
    { match: "exact", value: "crm" },
  ],
  [
    "Research project reads",
    "research-agent",
    "postgres",
    "contacts.read",
    "schema",
    "allow",
    { match: "exact", value: "research" },
  ],
  [
    "No refunds by agents",
    "billing-assistant",
    "stripe",
    "refunds.create",
    "invoice",
    "deny",
    { match: "any" },
  ],
  [
    "Invoice lookups",
    "billing-assistant",
    "stripe",
    "invoices.get",
    "invoice",
    "allow",
    { match: "any" },
  ],
] as const;

/** What already happened: every kind of outcome Activity can show. */
const sampleHistory = [
  {
    agent: "support-agent",
    action: ["github", "issues.list", "repository", "acme/support"],
    params: { state: "open" },
    minutes: 18,
    outcome: "allowed_by_rule",
    report: "success",
  },
  {
    agent: "billing-assistant",
    action: ["stripe", "refunds.create", "invoice", "INV-1987"],
    params: { amount: 48, currency: "USD" },
    minutes: 32,
    outcome: "denied_by_rule",
  },
  {
    agent: "support-agent",
    action: ["github", "repositories.delete", "repository", "acme/support"],
    params: { repository: "acme/support" },
    minutes: 42,
    outcome: "denied_by_rule",
  },
] as const;

type SeedScope = {
  workspaceId: string;
  environmentId: string;
  policyVersionId: string;
};

type SeedInstall = { agentId: string; installationId: string };

const evaluationFor: Record<string, string> = {
  allowed_by_rule: "ready",
  denied_by_rule: "denied",
};

function insertAction(
  manager: EntityManager,
  scope: SeedScope,
  install: SeedInstall,
  [toolKey, operationKey, resourceKind, resourceId]: readonly string[],
  fields: {
    paramsSafe: object;
    initialEvaluation: string;
    expiresAt: Date;
    createdAt?: Date;
  },
) {
  const id = randomUUID();
  return manager
    .insert(ActionRequest, {
      id,
      workspaceId: scope.workspaceId,
      installationId: install.installationId,
      agentId: install.agentId,
      environmentId: scope.environmentId,
      idempotencyKey: randomUUID(),
      toolKey: toolKey ?? "",
      operationKey: operationKey ?? "",
      resourceKind: resourceKind ?? "",
      resourceId: resourceId ?? "",
      permissionFingerprint: `${toolKey}.${operationKey}:${resourceId}`,
      descriptorDigest: randomBytes(32).toString("hex"),
      actionDigest: randomBytes(32).toString("hex"),
      initialPolicyVersionId: scope.policyVersionId,
      accessEpoch: 1,
      ...fields,
    })
    .then(() => id);
}

async function seedHistory(
  manager: EntityManager,
  scope: SeedScope,
  installs: Map<string, SeedInstall>,
) {
  const { workspaceId, environmentId, policyVersionId } = scope;
  for (const sample of sampleHistory) {
    const install = installs.get(sample.agent);
    if (!install) throw new Error(`Unknown sample agent ${sample.agent}`);
    const occurredAt = minutesAgo(sample.minutes);
    const actionRequestId = await insertAction(
      manager,
      scope,
      install,
      sample.action,
      {
        paramsSafe: sample.params,
        initialEvaluation: evaluationFor[sample.outcome] ?? "denied",
        createdAt: occurredAt,
        expiresAt: new Date(
          occurredAt.getTime() + REQUEST_TTL_MINUTES * 60_000,
        ),
      },
    );
    await manager.insert(AuditEvent, {
      workspaceId,
      occurredAt,
      eventType: "authorization.decided",
      actorKind: "system",
      actorUserId: null,
      actionRequestId,
      agentId: install.agentId,
      environmentId,
      policyVersionId,
      decisionCode: sample.outcome,
    });
    if ("report" in sample)
      await manager.insert(ClientReport, {
        workspaceId,
        installationId: install.installationId,
        actionRequestId,
        clientReportKey: randomUUID(),
        outcome: sample.report,
        receivedAt: minutesAgo(sample.minutes - 1),
      });
  }
}

async function seedRules(
  manager: EntityManager,
  workspaceId: string,
  environmentId: string,
  policyVersionId: string,
  updatedBy: string,
) {
  for (const [
    name,
    agentKey,
    toolKey,
    operationKey,
    kind,
    effect,
    scope,
  ] of sampleRules) {
    const agent = agentKey
      ? await manager.findOneByOrFail(Agent, {
          workspaceId,
          externalKey: agentKey,
        })
      : null;
    await manager.insert(PolicyRule, {
      workspaceId,
      environmentId,
      policyVersionId,
      logicalRuleId: randomUUID(),
      name,
      agentId: agent?.id ?? null,
      toolKey,
      operationKey,
      effect,
      resourceScope: { kind, ...scope },
      updatedBy,
      updatedAt: new Date(),
    });
  }
}

async function seedTeam(manager: EntityManager) {
  const workspaceId = randomUUID();
  const team: { userId: string; role: Role; owner: boolean }[] = [];
  for (const person of people) {
    const userId = randomUUID();
    await manager.insert(User, {
      id: userId,
      displayName: person.name,
      verifiedEmail: person.email,
    });
    await manager.insert(LoginAccount, {
      userId,
      email: person.email,
      emailVerifiedAt: new Date(),
    });
    team.push({ userId, role: person.role, owner: person.owner ?? false });
  }
  const owner = team.find((person) => person.owner);
  if (!owner) throw new Error("The sample team needs an owner");
  await provisionWorkspace(manager, {
    id: workspaceId,
    name: "Acme Studio",
    slug: "acme-studio",
    ownerUserId: owner.userId,
  });
  for (const person of team.filter((item) => !item.owner))
    await manager.insert(WorkspaceMembership, {
      workspaceId,
      userId: person.userId,
      role: person.role,
    });
}

/** A recent call no rule covered: denied, as it would be now. */
async function seedUncovered(
  manager: EntityManager,
  scope: SeedScope,
  install: SeedInstall,
  [action, params]: [readonly string[], object],
) {
  const actionRequestId = await insertAction(manager, scope, install, action, {
    paramsSafe: params,
    initialEvaluation: "denied",
    expiresAt: new Date(Date.now() + REQUEST_TTL_MINUTES * 60_000),
  });
  await manager.insert(AuditEvent, {
    workspaceId: scope.workspaceId,
    eventType: "authorization.decided",
    actorKind: "runtime",
    actionRequestId,
    agentId: install.agentId,
    environmentId: scope.environmentId,
    policyVersionId: scope.policyVersionId,
    decisionCode: "denied_no_rule",
  });
}

async function seedAgents(manager: EntityManager, workspaceId: string) {
  const development = await manager.findOneByOrFail(Environment, {
    workspaceId,
    slug: "development",
  });
  const { policyVersionId } = await manager.findOneByOrFail(ActivePolicy, {
    workspaceId,
    environmentId: development.id,
  });
  const memberByEmail = new Map(
    (await manager.find(User)).map((user) => [user.verifiedEmail, user.id]),
  );
  const member = (email: string) => {
    const id = memberByEmail.get(email);
    if (!id) throw new Error(`Unknown sample person ${email}`);
    return id;
  };
  const owner = member("dev@nodrail.test");
  const scope = { workspaceId, environmentId: development.id, policyVersionId };
  const installs = new Map<string, SeedInstall>();

  for (const sample of sampleAgents) {
    const pausedBy = "pausedBy" in sample ? sample.pausedBy : null;
    const agentId = randomUUID();
    const installationId = randomUUID();
    await manager.insert(Agent, {
      id: agentId,
      workspaceId,
      externalKey: sample.key,
      description: sample.description,
      ...(pausedBy
        ? {
            accessStatus: "paused" as const,
            pausedAt: minutesAgo(60),
            pausedBy: member(pausedBy),
          }
        : {}),
    });
    for (const email of sample.assignees)
      await manager.insert(AgentMember, {
        workspaceId,
        agentId,
        userId: member(email),
      });
    installs.set(sample.key, { agentId, installationId });
    if (pausedBy)
      await manager.insert(AuditEvent, {
        workspaceId,
        occurredAt: minutesAgo(60),
        eventType: "agent.paused",
        actorKind: "human",
        actorUserId: member(pausedBy),
        agentId,
        decisionCode: "agent_paused",
      });
    await manager.insert(Installation, {
      id: installationId,
      workspaceId,
      agentId,
      environmentId: development.id,
      name: `${sample.key.split("-")[0]}-dev`,
      adapterKey: sample.adapterKey,
      lastSeenAt: minutesAgo(sample.lastSeen),
    });
    await manager.insert(InstallationCredential, {
      workspaceId,
      installationId,
      publicPrefix: randomBytes(6).toString("hex"),
      secretDigest: randomBytes(32).toString("hex"),
      scopes: [],
      createdBy: owner,
    });
    for (const [
      toolKey,
      operationKey,
      resourceKind,
      resourceLabel,
      lastOutcome,
    ] of sample.observed)
      await manager.insert(ObservedPermission, {
        workspaceId,
        installationId,
        permissionFingerprint: `${toolKey}.${operationKey}:${resourceLabel}`,
        toolKey,
        operationKey,
        resourceKind,
        resourceLabel,
        lastOutcome,
      });
    if (sample.pending)
      await seedUncovered(manager, scope, { agentId, installationId }, [
        sample.pending,
        sample.pendingParams,
      ]);
  }
  await seedHistory(manager, scope, installs);
  await manager.query(
    `INSERT INTO nodrail.billing_usage (workspace_id, period, intents)
     VALUES ($1, date_trunc('month', timezone('UTC', now()))::date, 612)`,
    [workspaceId],
  );
  // Older than the sample history, as a real workspace would be.
  await manager.update(
    Workspace,
    { id: workspaceId },
    { createdAt: minutesAgo(24 * 60) },
  );
  // Its link was never issued, so the sample shows on Team and cannot be used.
  await manager.insert(WorkspaceInvite, {
    workspaceId,
    normalizedEmail: "riley@nodrail.test",
    proposedRole: "viewer",
    tokenDigest: randomBytes(32).toString("hex"),
    inviterUserId: owner,
    expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000),
  });
  await seedRules(manager, workspaceId, development.id, policyVersionId, owner);
}

async function main() {
  const database = new DataSource(dataSourceOptions(databaseUrl));
  await database.initialize();
  const workspaces = database.getRepository(Workspace);

  if (!(await workspaces.existsBy({ slug: "acme-studio" })))
    await database.transaction(seedTeam);
  const { id } = await workspaces.findOneByOrFail({ slug: "acme-studio" });
  if (await database.getRepository(Agent).existsBy({ workspaceId: id }))
    console.log("Sample agents already present.");
  else await database.transaction((manager) => seedAgents(manager, id));

  console.log("Acme Studio is ready. Sign in as dev@nodrail.test.");
  await database.destroy();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
