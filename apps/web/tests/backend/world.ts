import { randomBytes, randomUUID } from "node:crypto";
import type { ActionStatus } from "@nodrail/sdk/protocol";
import { afterAll, beforeAll, describe, vi } from "vitest";
import { DataSource, type EntityManager, type QueryRunner } from "typeorm";
import type { Role } from "@/contracts/v1/access";
import type { RuleInput } from "@/contracts/v1/policies";
import {
  ActionRequest,
  Agent,
  AgentMember,
  AuditEvent,
  HumanSession,
  Installation,
  InstallationCredential,
  ObservedPermission,
  PolicyRule,
  User,
  WorkspaceMembership,
} from "@/server/db/entities";
import { dataSourceOptions } from "@/server/db/options";
import { provisionWorkspace } from "@/server/db/provisioning";
import {
  withRuntime,
  withWorkspace,
  type HumanPrincipal,
} from "@/server/db/context";
import {
  recordHeartbeat,
  requestPermit,
  submitAction,
} from "@/server/modules/runtime";
import { rotateCredential } from "@/server/modules/agents";
import { createApiToken } from "@/server/modules/api-tokens";
import {
  backendTestDatabase,
  testAuthRole,
  testDatabaseUrl,
} from "../support/local-stack";

const { database, appRole } = backendTestDatabase();
/** The restricted login the suite connects as, like the deployed app. */
export const appLogin = appRole;
export const appUrl = testDatabaseUrl(appRole, database);
export const adminUrl = testDatabaseUrl("postgres", database);

// The context module connects with this, as the restricted application role.
process.env.DATABASE_URL = appUrl;
process.env.AUTH_DATABASE_URL = testDatabaseUrl(
  testAuthRole(database),
  database,
);

export const admin = new DataSource(dataSourceOptions(adminUrl));
export const appDirect = new DataSource(dataSourceOptions(appUrl));

/** Connects the two test roles for the suite that calls it. */
export function useDatabase() {
  beforeAll(async () => {
    await admin.initialize();
    await appDirect.initialize();
  });
  afterAll(async () => {
    await appDirect.destroy();
    await admin.destroy();
  });
}

export type Person = HumanPrincipal & { name: string; email: string };

export async function createPerson(name: string): Promise<Person> {
  const email = `${randomUUID()}@example.test`;
  const user = await admin
    .getRepository(User)
    .save({ displayName: name, verifiedEmail: email });
  const session = await admin.getRepository(HumanSession).save({
    userId: user.id,
    tokenDigest: randomBytes(32).toString("hex"),
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  return { userId: user.id, sessionId: session.id, name, email };
}

export type TestWorkspace = {
  id: string;
  owner: Person;
  environmentId: string;
  versionId: string;
};

export async function createWorkspace(): Promise<TestWorkspace> {
  const owner = await createPerson("Owner");
  const id = randomUUID();
  const { development } = await admin.transaction((manager) =>
    provisionWorkspace(manager, {
      id,
      name: "Test",
      slug: `w-${id}`.slice(0, 40),
      ownerUserId: owner.userId,
    }),
  );
  return { id, owner, ...development };
}

export async function addMember(workspace: TestWorkspace, role: Role) {
  const person = await createPerson(role);
  await admin.getRepository(WorkspaceMembership).insert({
    workspaceId: workspace.id,
    userId: person.userId,
    role,
  });
  return person;
}

export type TestAgent = {
  id: string;
  key: string;
  installationId: string;
  credentialId: string;
  actionId: string;
};

const expiry = () => new Date(Date.now() + 3_600_000);

export type ActionOverrides = Partial<
  Pick<
    ActionRequest,
    "toolKey" | "operationKey" | "resourceKind" | "resourceId"
  >
>;

export async function seedAction(
  manager: EntityManager,
  workspace: TestWorkspace,
  agent: { id: string; installationId: string },
  overrides: ActionOverrides = {},
) {
  const actionId = randomUUID();
  await manager.insert(ActionRequest, {
    id: actionId,
    workspaceId: workspace.id,
    installationId: agent.installationId,
    agentId: agent.id,
    environmentId: workspace.environmentId,
    idempotencyKey: randomUUID(),
    toolKey: "github",
    operationKey: "issues.delete",
    resourceKind: "issue",
    resourceId: "acme/support#482",
    paramsSafe: { issue: 482 },
    ...overrides,
    permissionFingerprint: "fp",
    descriptorDigest: "d",
    actionDigest: `a-${actionId}`,
    initialPolicyVersionId: workspace.versionId,
    accessEpoch: 1,
    initialEvaluation: "denied",
    expiresAt: expiry(),
  });
  return { actionId };
}

export const ruleBody = (overrides: Partial<RuleInput> = {}): RuleInput => ({
  name: "A rule",
  effect: "allow",
  agentKey: null,
  installationName: null,
  toolKey: "github",
  operationKey: "issues.delete",
  resource: { kind: "issue", match: "any" },
  conditions: [],
  expiresAt: null,
  ...overrides,
});

/**
 * Starts the racer while `prepare` holds its locks, then commits, so the change
 * always lands first even though the racer began first.
 */
export async function losesRaceTo<T>(
  prepare: (query: QueryRunner["query"]) => Promise<unknown>,
  racer: () => Promise<T>,
): Promise<T> {
  const blocker = admin.createQueryRunner();
  await blocker.connect();
  await blocker.startTransaction();
  await prepare(blocker.query.bind(blocker));
  const result = racer();
  result.catch(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 200));
  await blocker.commitTransaction();
  await blocker.release();
  return result;
}

/** Issues a real credential, the way connecting an agent does. */
export const issueToken = async (w: TestWorkspace, agent: TestAgent) =>
  (
    await withWorkspace(w.owner, w.id, (context) =>
      rotateCredential(context, agent.installationId),
    )
  ).secret;

/** A workspace with one agent and a working credential. */
export async function workspaceWithToken() {
  const w = await createWorkspace();
  const agent = await createAgent(w, "bot");
  return { w, agent, token: await issueToken(w, agent) };
}

export const checkIn = (token: string) =>
  withRuntime(token, "heartbeat:write", (context) =>
    recordHeartbeat(context, {}),
  );

export const issueDescriptor = {
  tool: "github",
  operation: "issues.create",
  resource: { kind: "repository", id: "acme/app" },
  params: {},
};

export const submitIssue = (token: string, key: string = randomUUID()) =>
  withRuntime(token, "actions:submit", (context) =>
    submitAction(context, key, issueDescriptor),
  );

/** One logical call, retried twice, followed by a check-in. */
export async function retriedCallAndCheckIn(token: string) {
  const key = randomUUID();
  for (let attempt = 0; attempt < 3; attempt += 1)
    await submitIssue(token, key);
  await checkIn(token);
}

/** An agent with one installation, credential, request, observation and rule. */
export async function createAgent(
  workspace: TestWorkspace,
  key: string,
  assignees: Person[] = [],
): Promise<TestAgent> {
  return admin.transaction(async (manager) => {
    const id = randomUUID();
    const installationId = randomUUID();
    const credentialId = randomUUID();
    await manager.insert(Agent, {
      id,
      workspaceId: workspace.id,
      externalKey: key,
    });
    for (const person of assignees)
      await manager.insert(AgentMember, {
        workspaceId: workspace.id,
        agentId: id,
        userId: person.userId,
      });
    await manager.insert(Installation, {
      id: installationId,
      workspaceId: workspace.id,
      agentId: id,
      environmentId: workspace.environmentId,
      name: `${key}-dev`,
      adapterKey: "test",
    });
    await manager.insert(InstallationCredential, {
      id: credentialId,
      workspaceId: workspace.id,
      installationId,
      publicPrefix: randomUUID().slice(0, 12),
      secretDigest: "digest",
      scopes: ["actions:submit"],
      createdBy: workspace.owner.userId,
    });
    const { actionId } = await seedAction(manager, workspace, {
      id,
      installationId,
    });
    await manager.insert(ObservedPermission, {
      workspaceId: workspace.id,
      installationId,
      permissionFingerprint: "fp",
      toolKey: "github",
      operationKey: "issues.delete",
      resourceKind: "issue",
      resourceLabel: "acme/support#482",
      lastOutcome: "unknown_blocked",
      lastActionRequestId: actionId,
    });
    await manager.insert(PolicyRule, {
      workspaceId: workspace.id,
      environmentId: workspace.environmentId,
      policyVersionId: workspace.versionId,
      logicalRuleId: randomUUID(),
      name: `${key} rule`,
      agentId: id,
      toolKey: "github",
      operationKey: "issues.list",
      effect: "allow",
      resourceScope: { kind: "repository", match: "any" },
      updatedBy: workspace.owner.userId,
      updatedAt: new Date(),
    });
    await manager.insert(AuditEvent, {
      workspaceId: workspace.id,
      eventType: "authorization.decided",
      actorKind: "system",
      decisionCode: "allowed_by_rule",
      agentId: id,
      actionRequestId: actionId,
      environmentId: workspace.environmentId,
    });
    return {
      id,
      key,
      installationId,
      credentialId,
      actionId,
    };
  });
}

/** Asks for the permit of an action that is READY, as an integration does. */
export const permitFor = (token: string, action: ActionStatus) =>
  withRuntime(token, "permits:request", (context) =>
    requestPermit(context, action.action_id, {
      action_digest: action.action_digest,
      nonce: randomBytes(16).toString("hex"),
    }),
  );

/**
 * Pins the deployment mode for the enclosing suite (or file), whatever the
 * shell sets. For suites that test one mode's behaviour, such as Cloud plans.
 */
export function useDeployment(mode: "cloud" | "self-hosted") {
  beforeAll(() => {
    vi.stubEnv("NODRAIL_DEPLOYMENT", mode);
  });
  afterAll(() => {
    vi.unstubAllEnvs();
  });
}

/** Runs a suite once per deployment mode, with NODRAIL_DEPLOYMENT set. */
export function inEachMode(suite: () => void) {
  describe.each(["cloud", "self-hosted"])("deployment: %s", (mode) => {
    beforeAll(() => {
      vi.stubEnv("NODRAIL_DEPLOYMENT", mode);
    });
    afterAll(() => {
      vi.unstubAllEnvs();
    });
    suite();
  });
}

/** A personal API token that only reads, for the workspace's owner. */
export async function readerToken(workspace: TestWorkspace) {
  const { secret } = await withWorkspace(
    workspace.owner,
    workspace.id,
    (context) =>
      createApiToken(context, {
        name: "reader",
        scopes: ["read"],
        expiresInDays: 30,
      }),
  );
  return secret;
}
