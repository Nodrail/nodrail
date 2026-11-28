import { createHash, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, test } from "vitest";
import { GET as liveRoute } from "@/app/api/v1/rules/live/route";
import { GET as accessRoute } from "@/app/api/v1/runtime/access/route";
import { GET as identityRoute } from "@/app/api/v1/runtime/identity/route";
import { GET as policyRoute } from "@/app/api/v1/runtime/policy/route";
import { POST as disconnectRoute } from "@/app/api/v1/runtime/disconnect/route";
import { POST as reportRoute } from "@/app/api/v1/runtime/inventory/route";
import { GET as inventoryRoute } from "@/app/api/v1/inventory/route";
import { GET as agentsRoute } from "@/app/api/v1/agents/route";
import { POST as reconcileRoute } from "@/app/api/v1/projects/enrollment/reconcile/route";
import { POST as applyRoute } from "@/app/api/v1/projects/apply/route";
import {
  approveCliLogin,
  exchangeCliLogin,
  startCliLogin,
} from "@/server/auth/cli-login";
import { newToken, tokenDigest } from "@/server/auth/token";
import type { ProjectApply } from "@/contracts/v1/project-apply";
import {
  withRuntime,
  withWorkspace,
  type HumanPrincipal,
} from "@/server/db/context";
import {
  Agent,
  AgentMember,
  Installation,
  Workspace,
} from "@/server/db/entities";
import { createApiToken } from "@/server/modules/api-tokens";
import {
  listAgents,
  pauseAgent,
  revokeCredential,
  rotateCredential,
} from "@/server/modules/agents";
import { changeProjectAccess } from "@/server/modules/agents/project-access";
import { enrollmentPreflight } from "@/server/modules/policies/enrollment-preflight";
import { runtimeCaller } from "@/server/modules/runtime/caller";
import { reserveSharedBudgets } from "@/server/modules/budgets/host";
import { runtimeEvidenceStatus } from "@/server/modules/evidence/status";
import { createVerifier } from "@/server/modules/evidence/verifiers";
import { evidencePins } from "@nodrail/sdk/command-line";
import { compilePolicies } from "@nodrail/sdk/yaml";
import { getIntendedRevision } from "@/server/modules/inventory/revisions";
import {
  readLiveVersion,
  readRuntimePolicy,
} from "@/server/modules/policies/managed";
import { applyProject } from "@/server/modules/policies/project-apply";
import { previewPolicyFile } from "@/server/modules/policies/rule-files";
import {
  addMember,
  admin,
  createWorkspace,
  readerToken,
  useDatabase,
  type TestWorkspace,
} from "./world";

useDatabase();
const origin = "https://enroll.example.test";
process.env.APP_ORIGIN = origin;

const environment = "development";
const yaml = `- rule: Read issues
  tool: github
  operation: issues.read
  resource: { kind: issue, match: any }
  agent: support
  effect: allow
`;

function project(overrides: Partial<ProjectApply> = {}): ProjectApply {
  const project_id = randomUUID();
  return {
    yaml,
    policy_revision: 1,
    declarations: {
      project_id,
      agents: [{ key: "support", description: "Answers support" }],
    },
    intended: {
      project_id,
      project: "Support",
      revision: "a".repeat(64),
      policy_revision: createHash("sha256").update(yaml).digest("hex"),
      files: [],
    },
    machine: {
      id: randomUUID(),
      runtime: "claude-code",
      expected_credential: null,
    },
    ...overrides,
  };
}

async function preview(
  w: TestWorkspace,
  actor: HumanPrincipal,
  input: ProjectApply,
  target = environment,
) {
  return withWorkspace(actor, w.id, (context) =>
    previewPolicyFile(context, target, input.yaml, input),
  );
}

const apply = (
  w: TestWorkspace,
  actor: HumanPrincipal,
  input: ProjectApply,
  target = environment,
) =>
  withWorkspace(actor, w.id, (context) => applyProject(context, target, input));

async function reviewed(
  w: TestWorkspace,
  actor: HumanPrincipal,
  input: ProjectApply,
  target = environment,
) {
  const plan = await preview(w, actor, input, target);
  return {
    ...input,
    file_digest: plan.fileDigest,
    policy_revision: plan.policyRevision,
  };
}

const policy = (secret: string) =>
  withRuntime(secret, "policy:read", readRuntimePolicy);

test("reconcile fences a never-activated generation and revokes only the exact activated generation", async () => {
  const w = await createWorkspace();
  const verifier = newToken();
  const challenge = tokenDigest(verifier);
  await startCliLogin(origin, challenge);
  await approveCliLogin(challenge, w.owner);
  const { token } = await exchangeCliLogin({ verifier, origin });
  const input = project();
  const propose = (prefix: string, secret: string) => ({
    ...input,
    machine: {
      ...input.machine!,
      proposed_credential: {
        prefix,
        digest: createHash("sha256").update(secret).digest("hex"),
      },
    },
  });
  const reconcile = async (generation: string, bearer = token) => {
    const response = await reconcileRoute(
      new NextRequest(
        `${origin}/api/v1/projects/enrollment/reconcile?workspace=w-${w.id}&environment=${environment}`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${bearer}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            project_id: input.intended.project_id,
            machine_id: input.machine!.id,
            generation,
          }),
        },
      ),
      { params: Promise.resolve({}) },
    );
    return { status: response.status, body: await response.json() };
  };
  const missing = "bb123456de78";
  const late = await reviewed(w, w.owner, propose(missing, "V".repeat(43)));
  expect(await reconcile(missing)).toEqual({
    status: 200,
    body: { status: "never_activated" },
  });
  await expect(apply(w, w.owner, late)).rejects.toMatchObject({
    code: "RULE_CHANGED",
  });
  const activated = "cc123456de78";
  const secret = "R".repeat(43);
  await apply(
    w,
    w.owner,
    await reviewed(w, w.owner, propose(activated, secret)),
  );
  const machine = `ndr_${activated}_${secret}`;
  expect((await reconcile(activated, machine)).status).toBe(401);
  expect(await reconcile(missing)).toEqual({
    status: 200,
    body: { status: "never_activated" },
  });
  await expect(policy(machine)).resolves.toBeDefined();
  expect(await reconcile(activated)).toEqual({
    status: 200,
    body: { status: "revoked" },
  });
  expect(await reconcile(activated)).toEqual({
    status: 200,
    body: { status: "revoked" },
  });
  await expect(policy(machine)).rejects.toMatchObject({
    code: "UNAUTHENTICATED",
  });
});

describe("declarative project publication and machine enrollment", () => {
  test("a policy manager previews and adopts bootstrap, registering and updating its agent", async () => {
    const w = await createWorkspace();
    const manager = await addMember(w, "policy_manager");
    const input = project();
    const plan = await preview(w, manager, input);
    expect(plan).toMatchObject({
      policyRevision: 1,
      issues: [],
      added: ["agent support", "Read issues"],
      policyCounts: { added: 1, changed: 0, removed: 0 },
      agentChanges: { added: ["support"], changed: [], removed: [] },
      publishesPolicy: true,
      removed: [],
    });
    expect(
      await admin.getRepository(Agent).findBy({ workspaceId: w.id }),
    ).toEqual([]);
    const result = await apply(w, manager, {
      ...input,
      file_digest: plan.fileDigest,
    });
    expect(result.published?.policyRevision).toBe(2);
    const initial = await admin.getRepository(Agent).findOneByOrFail({
      workspaceId: w.id,
      externalKey: "support",
    });
    const installation = await admin
      .getRepository(Installation)
      .findOneByOrFail({ id: result.enrollment!.installationId });
    expect(installation).toMatchObject({
      enrollmentProjectId: input.intended.project_id,
      enrollmentMachineId: input.machine!.id,
      enrollmentAgentKeys: ["support"],
    });
    const intended = await withWorkspace(manager, w.id, (context) =>
      getIntendedRevision(context, environment, input.intended.project_id),
    );
    expect(intended?.revision).toBe(input.intended.revision);

    const update = {
      ...input,
      declarations: {
        ...input.declarations,
        agents: [{ key: "support", description: "Handles tickets" }],
      },
      intended: { ...input.intended, revision: "b".repeat(64) },
      machine: {
        ...input.machine!,
        credential: result.enrollment!.credential!,
      },
    };
    const next = await preview(w, manager, update);
    expect(next.changed).toEqual(["agent support"]);
    const applied = await apply(w, manager, {
      ...update,
      file_digest: next.fileDigest,
      policy_revision: next.policyRevision,
    });
    expect(applied.enrollment).toEqual({
      installationId: installation.id,
      credential: null,
    });
    expect(
      await admin.getRepository(Agent).findOneByOrFail({ id: initial.id }),
    ).toMatchObject({ description: "Handles tickets" });
  });

  test("successive host-only locks keep the policy version and every reviewed runtime pin", async () => {
    const w = await createWorkspace();
    const input = await reviewed(w, w.owner, project());
    const initial = await apply(w, w.owner, input);
    const credential = initial.enrollment!.credential!;
    const checkAccess = (revision: string) =>
      accessRoute(
        new NextRequest(
          `https://enroll.example.test/api/v1/runtime/access?${new URLSearchParams(
            {
              workspace_revision: revision,
              policy_digest: input.intended.policy_revision!,
              agent: "support",
            },
          )}`,
          { headers: { authorization: `Bearer ${credential}` } },
        ),
        { params: Promise.resolve({}) },
      );
    for (const mode of ["watch", "on"]) {
      const update = {
        ...input,
        machine: undefined,
        intended: {
          ...input.intended,
          revision: createHash("sha256").update(mode).digest("hex"),
          files: [
            {
              path: "nodrail.yaml",
              sha256: createHash("sha256")
                .update(`enforce: ${mode}`)
                .digest("hex"),
            },
          ],
        },
      };
      const next = await preview(w, w.owner, update);
      expect(next).toMatchObject({
        policyRevision: 2,
        policyCounts: { added: 0, changed: 0, removed: 0 },
        publishesPolicy: false,
      });
      expect(
        await apply(w, w.owner, {
          ...update,
          file_digest: next.fileDigest,
          policy_revision: next.policyRevision,
        }),
      ).toMatchObject({ published: null });
      expect((await checkAccess(update.intended.revision)).status).toBe(200);
    }
    expect(
      (await checkAccess(createHash("sha256").update("watch").digest("hex")))
        .status,
    ).toBe(200);
    expect((await checkAccess(input.intended.revision)).status).toBe(200);
    expect((await checkAccess("c".repeat(64))).status).toBe(404);
    const secret = await readerToken(w);
    const watch = createHash("sha256").update("watch").digest("hex");
    for (const [revision, current] of [
      [watch, true],
      ["c".repeat(64), false],
    ] as const) {
      const response = await liveRoute(
        new NextRequest(
          `https://enroll.example.test/api/v1/rules/live?workspace=w-${w.id}&environment=${environment}&workspace_revision=${revision}`,
          { headers: { authorization: `Bearer ${secret}` } },
        ),
        { params: Promise.resolve({}) },
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        policy_revision: 2,
        workspace_lock_current: current,
      });
    }

    expect(
      await withWorkspace(w.owner, w.id, (context) =>
        readLiveVersion(context, environment),
      ),
    ).toMatchObject({
      policy_revision: 2,
      managed: { revision: input.intended.revision },
    });
  });

  test("an enrolled machine can read its policy while agent identity requires an agent credential", async () => {
    const w = await createWorkspace();
    const input = await reviewed(w, w.owner, project());
    const { enrollment } = await apply(w, w.owner, input);
    const get = (endpoint: string) =>
      new NextRequest(`${origin}/api/v1/runtime/${endpoint}`, {
        headers: { authorization: `Bearer ${enrollment!.credential!}` },
      });
    const segment = { params: Promise.resolve({}) };
    expect((await policyRoute(get("policy"), segment)).status).toBe(200);
    const identity = await identityRoute(get("identity"), segment);
    expect(identity.status).toBe(403);
    expect(await identity.json()).toMatchObject({
      error: { code: "FORBIDDEN" },
    });
  });

  test("inventory immediately shows a disconnected machine and keeps its last report", async () => {
    const w = await createWorkspace();
    const input = await reviewed(w, w.owner, project());
    const { enrollment } = await apply(w, w.owner, input);
    const credential = enrollment!.credential!;
    const request = (endpoint: string, body: object) =>
      new NextRequest(
        `https://enroll.example.test/api/v1/runtime/${endpoint}`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${credential}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        },
      );
    const revision = input.intended.revision;
    expect(
      (
        await reportRoute(
          request("inventory", {
            host: "claude-code",
            activation: "configured",
            in_step: true,
            drift: 0,
            unmanaged: {},
            applied_revision: revision,
            locked_revision: revision,
          }),
          { params: Promise.resolve({}) },
        )
      ).status,
    ).toBe(200);
    const secret = await readerToken(w);
    const inventory = () =>
      inventoryRoute(
        new NextRequest(
          `https://enroll.example.test/api/v1/inventory?workspace=w-${w.id}&environment=${environment}`,
          { headers: { authorization: `Bearer ${secret}` } },
        ),
        { params: Promise.resolve({}) },
      );
    const before = await inventory();
    expect(before.status).toBe(200);
    const {
      rows: [row],
    } = await before.json();
    expect(row).toMatchObject({ activation: "configured", in_step: true });
    expect(
      (
        await disconnectRoute(request("disconnect", {}), {
          params: Promise.resolve({}),
        })
      ).status,
    ).toBe(200);
    const after = await inventory();
    expect(after.status).toBe(200);
    expect(await after.json()).toMatchObject({
      rows: [{ ...row, activation: "disconnected", in_step: false }],
      summary: { reports: 1, configured: 0, disconnected: 1 },
    });
  });

  test("a project agent lists both of its installations and pausing it follows it to both machines", async () => {
    const w = await createWorkspace();
    const input = await reviewed(w, w.owner, project());
    const first = (await apply(w, w.owner, input)).enrollment!;
    const second = (
      await apply(w, w.owner, {
        ...input,
        policy_revision: 2,
        machine: { ...input.machine!, id: randomUUID() },
      })
    ).enrollment!;
    const enrolled = await withWorkspace(w.owner, w.id, (context) =>
      listAgents(context, environment),
    );
    const ids = [first.installationId, second.installationId];
    expect(enrolled.items).toHaveLength(3);
    expect(enrolled.items.find(({ key }) => key === "support")).toMatchObject({
      project: input.intended.project_id,
      installations: expect.arrayContaining(
        ids.map((id) => expect.objectContaining({ id, machinePaused: false })),
      ),
    });
    await withWorkspace(w.owner, w.id, (context) =>
      pauseAgent(context, "support"),
    );
    for (const machine of [first, second]) {
      await withRuntime(machine.credential!, "policy:read", async (context) => {
        expect(await runtimeCaller(context, "support")).toMatchObject({
          refusal: expect.stringContaining("support"),
        });
        expect(await runtimeCaller(context)).toMatchObject({
          refusal: expect.stringContaining("support"),
        });
      });
    }
  });

  test("v1 lists only agents with an installation object and counts paused declarations separately", async () => {
    const w = await createWorkspace();
    const input = project();
    input.declarations.agents.push({ key: "uninstalled", description: null });
    const applied = await apply(w, w.owner, await reviewed(w, w.owner, input));
    const installationId = applied.enrollment!.installationId;
    // This declaration has not been admitted on this machine.
    await admin.getRepository(Installation).update(
      { id: installationId },
      {
        enrollmentAgentKeys: ["support"],
        lastSeenAt: new Date(),
      },
    );
    await withWorkspace(w.owner, w.id, (context) =>
      pauseAgent(context, "uninstalled"),
    );
    await withRuntime(
      applied.enrollment!.credential!,
      "policy:read",
      async (context) => {
        // A live declaration can be newer than a machine's admitted caller keys.
        expect(await runtimeCaller(context)).toMatchObject({
          refusal: expect.stringContaining("uninstalled"),
        });
        expect(await runtimeCaller(context, "support")).toMatchObject({
          refusal: null,
        });
      },
    );
    const list = () =>
      withWorkspace(w.owner, w.id, (context) =>
        listAgents(context, environment),
      );
    expect((await list()).items).toContainEqual(
      expect.objectContaining({
        key: "uninstalled",
        installation: null,
        installations: [],
      }),
    );
    expect((await list()).summary).toEqual({
      connected: 1,
      reporting: 1,
      paused: 1,
    });
    const { secret } = await withWorkspace(w.owner, w.id, (context) =>
      createApiToken(context, {
        name: "legacy",
        scopes: ["read"],
        expiresInDays: 30,
      }),
    );
    const response = await agentsRoute(
      new NextRequest(
        `https://enroll.example.test/api/v1/agents?workspace=w-${w.id}&environment=${environment}`,
        { headers: { authorization: `Bearer ${secret}` } },
      ),
      { params: Promise.resolve({}) },
    );
    expect(response.status).toBe(200);
    const { items } = (await response.json()) as {
      items: { key: string; installation: { id: string } }[];
    };
    expect(items.map(({ installation }) => installation.id)).toEqual([
      installationId,
      installationId,
    ]);
    await withWorkspace(w.owner, w.id, (context) =>
      revokeCredential(context, installationId),
    );
    expect((await list()).summary).toEqual({
      connected: 0,
      reporting: 0,
      paused: 1,
    });
  });

  test("preview separates removed live catalog rules from removed project rules", async () => {
    const w = await createWorkspace();
    const before = project({ machine: undefined });
    before.yaml = `# ── @nodrail/example@1/rules.yaml
${yaml.replace("Read issues", "Catalog rule")}# ── policies/local.yaml
${yaml.replace("Read issues", "Project rule")}`;
    before.intended.policy_revision = createHash("sha256")
      .update(before.yaml)
      .digest("hex");
    await apply(w, w.owner, await reviewed(w, w.owner, before));
    const after = { ...before, yaml };
    after.intended = {
      ...before.intended,
      revision: "b".repeat(64),
      policy_revision: createHash("sha256").update(yaml).digest("hex"),
    };
    const changes = await preview(w, w.owner, after);
    expect(changes.issues).toEqual([]);
    expect(changes.removed).toEqual(
      expect.arrayContaining(["Catalog rule", "Project rule"]),
    );
    expect(changes.catalogRemoved).toEqual(["Catalog rule"]);
  });

  test("a writer PAT can apply and a read-only PAT cannot enroll a new machine", async () => {
    const w = await createWorkspace();
    const manager = await addMember(w, "policy_manager");
    const workspace = await admin
      .getRepository(Workspace)
      .findOneByOrFail({ id: w.id });
    const input = await reviewed(w, manager, project());
    for (const scopes of [["read"], ["rules:write"]]) {
      const { secret } = await withWorkspace(manager, w.id, (context) =>
        createApiToken(context, { name: scopes[0], scopes, expiresInDays: 30 }),
      );
      const path = `https://enroll.example.test/api/v1/projects/apply?workspace=${workspace.slug}&environment=${environment}`;
      const response = await applyRoute(
        new NextRequest(path, {
          method: "POST",
          headers: {
            authorization: `Bearer ${secret}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(input),
        }),
        { params: Promise.resolve({}) },
      );
      if (scopes[0] === "read") {
        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({
          error: {
            code: "INSUFFICIENT_SCOPE",
            message: "Requires rules:write.",
          },
        });
      } else {
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          enrollment: { credential: expect.stringMatching(/^ndr_/) },
        });
      }
    }
  });

  test("rotates one lost key while keeping another machine and environment independent", async () => {
    const w = await createWorkspace();
    const input = await reviewed(w, w.owner, project());
    const first = (await apply(w, w.owner, input)).enrollment!;
    const next = { ...input, policy_revision: 2, file_digest: undefined };
    const second = (
      await apply(w, w.owner, {
        ...next,
        machine: { ...input.machine!, id: randomUUID() },
      })
    ).enrollment!;
    const prod = (
      await apply(
        w,
        w.owner,
        await reviewed(w, w.owner, input, "production"),
        "production",
      )
    ).enrollment!;
    expect(
      new Set([
        first.installationId,
        second.installationId,
        prod.installationId,
      ]).size,
    ).toBe(3);
    expect(await policy(first.credential!)).toMatchObject({
      managed: { project_id: input.intended.project_id },
    });
    await expect(
      withRuntime(first.credential!, "permits:request", async () => true),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const [, prefix] = first.credential!.split("_");
    const teammate = await addMember(w, "policy_manager");
    const enrolled = await admin
      .getRepository(Installation)
      .findOneByOrFail({ id: first.installationId });
    await admin.getRepository(AgentMember).insert({
      workspaceId: w.id,
      agentId: enrolled.agentId,
      userId: teammate.userId,
    });
    await withWorkspace(w.owner, w.id, (context) =>
      changeProjectAccess(context, {
        action: "grant-apply",
        project_id: input.intended.project_id,
        user_id: teammate.userId,
      }),
    );
    await expect(
      apply(w, teammate, {
        ...next,
        machine: { ...input.machine!, expected_credential: prefix! },
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      detail: expect.stringContaining("user who enrolled this machine"),
    });
    const rotated = (
      await apply(w, w.owner, {
        ...next,
        machine: { ...input.machine!, expected_credential: prefix! },
      })
    ).enrollment!;
    expect(rotated.installationId).toBe(first.installationId);
    expect(rotated.credential).not.toBe(first.credential);
    await expect(policy(first.credential!)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    await withWorkspace(w.owner, w.id, (context) =>
      revokeCredential(context, rotated.installationId),
    );
    await expect(policy(rotated.credential!)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    await expect(apply(w, w.owner, next)).rejects.toMatchObject({
      code: "FORBIDDEN",
      detail: expect.stringContaining("enrollment was revoked"),
    });
    const restored = await withWorkspace(w.owner, w.id, (context) =>
      rotateCredential(context, rotated.installationId),
    );
    const reactivated = await apply(w, w.owner, {
      ...next,
      machine: { ...next.machine!, credential: restored.secret },
    });
    expect(reactivated.enrollment).toEqual({
      installationId: rotated.installationId,
      credential: null,
    });
    expect(await policy(second.credential!)).toMatchObject({
      source: { text: yaml },
    });
    expect(await policy(prod.credential!)).toMatchObject({
      source: { text: yaml },
    });
  });

  test("reports unresolved rule and gate targets at their lines and rolls back agent registration", async () => {
    const w = await createWorkspace();
    const input = project({ machine: undefined });
    input.yaml = `- required_engine_version: 3
${yaml.replace("agent: support", "agent: missing-rule")}- gate: Review first
  tool: github
  operation: issues.delete
  resource: { kind: issue, match: any }
  agent: missing-gate
  installation: missing-installation
  requires: [{ agent: reviewer, verdict: ship }]
  otherwise: deny
`;
    input.intended.policy_revision = createHash("sha256")
      .update(input.yaml)
      .digest("hex");
    const result = await preview(w, w.owner, input);
    expect(result.issues).toEqual([
      { line: 2, column: 1, message: 'No agent called "missing-rule".' },
      { line: 8, column: 1, message: 'No agent called "missing-gate".' },
      {
        line: 8,
        column: 1,
        message: 'No installation "missing-installation" for that agent here.',
      },
    ]);
    await expect(
      apply(w, w.owner, { ...input, file_digest: result.fileDigest }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(
      await admin.getRepository(Agent).findBy({ workspaceId: w.id }),
    ).toEqual([]);
    const live = await withWorkspace(w.owner, w.id, (context) =>
      readLiveVersion(context, environment),
    );
    expect(live.policy_revision).toBe(1);
  });

  test("requires the reviewed live revision and explicit takeover even with no rule diff", async () => {
    const w = await createWorkspace();
    const first = await reviewed(w, w.owner, emptyProject());
    const obsolete = await reviewed(w, w.owner, emptyProject());
    const { enrollment } = await apply(w, w.owner, first);
    await expect(apply(w, w.owner, obsolete)).rejects.toMatchObject({
      code: "RULE_CHANGED",
    });
    const replacement = emptyProject();
    const plan = await preview(w, w.owner, replacement);
    expect(plan).toMatchObject({
      added: [],
      changed: [],
      removed: [],
      takeover: {
        projectId: first.intended.project_id,
        hosts: [{ id: enrollment!.installationId }],
      },
    });
    const next = {
      ...replacement,
      policy_revision: plan.policyRevision,
      file_digest: plan.fileDigest,
    };
    await expect(apply(w, w.owner, next)).rejects.toMatchObject({
      code: "RULE_CHANGED",
    });
    const second = await apply(w, w.owner, {
      ...first,
      policy_revision: plan.policyRevision,
      machine: { ...first.machine!, id: randomUUID() },
    });
    await expect(
      apply(w, w.owner, { ...next, replace_live: true }),
    ).rejects.toMatchObject({ code: "RULE_CHANGED" });
    const refreshed = await reviewed(w, w.owner, replacement);
    const accepted = await apply(w, w.owner, {
      ...refreshed,
      replace_live: true,
    });
    expect(await policy(accepted.enrollment!.credential!)).toMatchObject({
      source: { text: "[]" },
    });
    for (const host of [enrollment, second.enrollment])
      expect(await policy(host!.credential!)).toMatchObject({
        source: null,
        denial_reason: `live policy is now owned by project ${replacement.intended.project_id}`,
      });
  });

  test("a project owner controls future applies across environments and can receive an explicit grant", async () => {
    const w = await createWorkspace();
    const owner = await addMember(w, "policy_manager");
    const teammate = await addMember(w, "policy_manager");
    const input = await reviewed(w, owner, project());
    await apply(w, owner, input);
    const production = await reviewed(w, owner, input, "production");
    await expect(
      preview(w, teammate, input, "production"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      apply(w, teammate, production, "production"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const grant = {
      action: "grant-apply",
      project_id: input.intended.project_id,
      user_id: teammate.userId,
    } as const;
    await expect(
      withWorkspace(owner, w.id, (context) =>
        changeProjectAccess(context, grant),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await withWorkspace(w.owner, w.id, (context) =>
      changeProjectAccess(context, grant),
    );
    expect(
      (await apply(w, teammate, production, "production")).enrollment
        ?.credential,
    ).toMatch(/^ndr_/);
  });

  test("foreign and console agents require an explicit admin binding", async () => {
    const w = await createWorkspace();
    const manager = await addMember(w, "policy_manager");
    await admin
      .getRepository(Agent)
      .save({ workspaceId: w.id, externalKey: "legacy" });
    const first = await reviewed(w, manager, project());
    await apply(w, manager, first);
    const next = emptyProject();
    next.declarations.agents = ["support", "legacy"].map((key) => ({
      key,
      description: null,
    }));
    const preflight = await preview(w, manager, next, "production");
    expect(preflight.issues.map(({ message }) => message)).toEqual([
      expect.stringContaining('"support" belongs to another project'),
      expect.stringContaining('"legacy" belongs to another project'),
    ]);
    await expect(
      apply(
        w,
        w.owner,
        await reviewed(w, w.owner, next, "production"),
        "production",
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    for (const agent of ["support", "legacy"])
      await withWorkspace(w.owner, w.id, (context) =>
        changeProjectAccess(context, {
          action: "bind-agent",
          project_id: next.intended.project_id,
          agent,
        }),
      );
    expect((await preview(w, manager, next, "production")).issues).toEqual([]);
    expect(
      (
        await apply(
          w,
          manager,
          await reviewed(w, manager, next, "production"),
          "production",
        )
      ).enrollment?.credential,
    ).toMatch(/^ndr_/);
  });

  test("a second machine refreshes keys and budget scope without rotating its credential", async () => {
    const w = await createWorkspace();
    const initial = await reviewed(w, w.owner, project());
    const first = (await apply(w, w.owner, initial)).enrollment!;
    const machine = { ...initial.machine!, id: randomUUID() };
    const second = (
      await apply(w, w.owner, { ...initial, policy_revision: 2, machine })
    ).enrollment!;
    const next = changedPolicy(
      initial,
      `- required_engine_version: 5
${yaml}- budget: Shared read allowance
  id: daily
  count: { tool: github, operation: issues.read }
  limit: 1
  per: day
  timezone: UTC
  across: environment
  otherwise: deny
`,
    );
    next.declarations.agents = [
      ...next.declarations.agents,
      { key: "engineer", description: null },
    ];
    next.machine = { ...initial.machine!, credential: first.credential! };
    await apply(w, w.owner, await reviewed(w, w.owner, next));
    const secondMachine = { ...machine, credential: second.credential! };
    const status = () =>
      withWorkspace(w.owner, w.id, (context) =>
        enrollmentPreflight(
          context,
          environment,
          initial.intended.project_id,
          secondMachine,
        ),
      );
    const budget = () =>
      withRuntime(second.credential!, "budgets:reserve", async () => true);
    await expect(status()).resolves.toMatchObject({
      valid: true,
      fresh: false,
    });
    await expect(budget()).rejects.toMatchObject({ code: "FORBIDDEN" });
    const result = await apply(w, w.owner, {
      ...next,
      policy_revision: 3,
      machine: secondMachine,
    });
    expect(result).toEqual({
      published: null,
      enrollment: { installationId: second.installationId, credential: null },
    });
    await expect(status()).resolves.toMatchObject({ valid: true, fresh: true });
    await expect(budget()).resolves.toBe(true);
    expect(
      await admin
        .getRepository(Installation)
        .findOneByOrFail({ id: second.installationId }),
    ).toMatchObject({ enrollmentAgentKeys: ["engineer", "support"] });
  });

  test("first apply pins evidence under the gate address used by the runtime", async () => {
    const w = await createWorkspace();
    const input = changedPolicy(emptyProject(), evidenceYaml);
    attachEvidencePins(input);
    await expect(preview(w, w.owner, input)).rejects.toMatchObject({
      code: "INVALID_INPUT",
      detail: expect.stringContaining("github-actions"),
    });
    await registerEvidenceVerifier(w);
    const reviewedInput = await reviewed(w, w.owner, input);
    const tampered = {
      ...reviewedInput,
      intended: { ...input.intended, evidence: undefined },
    };
    await expect(apply(w, w.owner, tampered)).rejects.toMatchObject({
      code: "INVALID_INPUT",
      detail: expect.stringContaining("evidence bindings"),
    });
    const { enrollment } = await apply(w, w.owner, reviewedInput);
    await expect(
      readPinnedEvidence(enrollment!.credential!, input),
    ).resolves.toMatchObject({ met: false, reason_code: "no_event" });
  });

  test("two checkouts keep budget and evidence access after the live policy drops both", async () => {
    const w = await createWorkspace();
    await registerEvidenceVerifier(w);
    const older = changedPolicy(project(), evidenceYaml + sharedBudgetYaml);
    attachEvidencePins(older);
    const first = (await apply(w, w.owner, await reviewed(w, w.owner, older)))
      .enrollment!;
    const newer = changedPolicy(
      project({
        declarations: older.declarations,
        intended: {
          ...older.intended,
          contracts: undefined,
          evidence: undefined,
        },
      }),
      yaml,
      "c",
    );
    const second = (await apply(w, w.owner, await reviewed(w, w.owner, newer)))
      .enrollment!;
    const oldMachine = { ...older.machine!, credential: first.credential! };
    const refreshed = await apply(w, w.owner, {
      ...newer,
      policy_revision: 3,
      machine: oldMachine,
    });
    expect(refreshed.enrollment).toEqual({
      installationId: first.installationId,
      credential: null,
    });

    const credentials = [first.credential!, second.credential!];
    for (const credential of credentials) {
      await expect(
        withRuntime(credential, "budgets:reserve", (context) =>
          reserveSharedBudgets(context, {
            agent: "support",
            call_fingerprint: randomUUID(),
            policy_digest: older.intended.policy_revision,
            calls: [{ tool: "github", operation: "issues.read" }],
          }),
        ),
      ).resolves.toMatchObject({ limits: [{ state: "ok" }] });
      await expect(
        readPinnedEvidence(credential, older),
      ).resolves.toMatchObject({ met: false, reason_code: "no_event" });
    }
  });
});

function readPinnedEvidence(credential: string, input: ProjectApply) {
  return withRuntime(credential, "evidence:read", (context) =>
    runtimeEvidenceStatus(context, {
      workspace_revision: input.intended.revision,
      gate: "tested",
      requirement: 0,
      subject: `sha256:${"f".repeat(64)}`,
    }),
  );
}

function attachEvidencePins(input: ProjectApply) {
  const compiled = compilePolicies([{ name: "rules", text: input.yaml }]);
  if (!compiled.ok || compiled.document.version !== 4)
    throw new Error("Expected an evidence policy");
  const evidence = evidencePins(compiled.document)!;
  const shape = compiled.document.evidence["ci-tests"]!;
  input.intended.contracts = {
    revisions: [
      {
        digest: shape.contract,
        name: "ci-result",
        surface: "evidence",
        dialect: 1,
        shape: shape.shape,
      },
    ],
    bindings: [
      {
        target: "evidence:ci-tests",
        surface: "evidence",
        contract_digest: shape.contract,
      },
    ],
  };
  input.intended.evidence = evidence;
}

async function registerEvidenceVerifier(w: TestWorkspace) {
  await withWorkspace(w.owner, w.id, (context) =>
    createVerifier(context, {
      name: "github-actions",
      repository_id: "42",
      repository: "team/ci",
      job_workflow_ref: "team/ci/.github/workflows/ci.yml@refs/heads/main",
      allowed_refs: ["refs/heads/*"],
      environments: [environment],
    }),
  );
}

const sharedBudgetYaml = `- budget: Shared read allowance
  id: daily
  count: { tool: github, operation: issues.read }
  limit: 10
  per: day
  timezone: UTC
  across: environment
`;

function changedPolicy(input: ProjectApply, text: string, revision = "b") {
  return {
    ...input,
    yaml: text,
    intended: {
      ...input.intended,
      revision: revision.repeat(64),
      policy_revision: createHash("sha256").update(text).digest("hex"),
    },
  };
}

function emptyProject() {
  const input = project();
  input.declarations.agents = [];
  return changedPolicy(input, "[]", "a");
}

const evidenceYaml = `- required_engine_version: 5
- contracts:
    shapes:
      ci-result:
        properties:
          status: { values: [passed, failed], report: true }
    evidence:
      ci-tests:
        shape: ci-result
        producers:
          - { class: externally-verified, verifier: github-actions }
        subject: revision
- gate: Tested before publishing
  id: tested
  tool: outbox
  operation: publish
  resource: { kind: mcp_tool, match: any }
  requires:
    - { evidence: ci-tests, authority: externally-verified, subject: revision, where: { status: passed } }
  otherwise: deny
`;
