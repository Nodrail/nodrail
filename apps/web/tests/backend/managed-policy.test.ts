// Connected mode: a version `nodrail apply` publishes names the
// repository project and lock it came from, and `/rules/live` says so, so
// `plan` can tell "in sync", "will publish" and "changed elsewhere" apart.
import { createHash, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, test } from "vitest";
import { GET as policyRoute } from "@/app/api/v1/runtime/policy/route";
import type { ManagedSource } from "@/contracts/v1/public-api";
import { withWorkspace, type WorkspaceContext } from "@/server/db/context";
import { withRuntime } from "@/server/db/runtime-context";
import { createRule } from "@/server/modules/policies";
import {
  readLiveVersion,
  readRuntimePolicy,
} from "@/server/modules/policies/managed";
import { readRepositoryProject } from "@/server/modules/policies/repository";
import {
  applyPolicyFile,
  previewPolicyFile,
} from "@/server/modules/policies/rule-files";
import {
  admin,
  createAgent,
  createWorkspace,
  issueToken,
  ruleBody,
  useDatabase,
  type TestWorkspace,
} from "./world";

useDatabase();

const ENV = "development";

const act = <T>(w: TestWorkspace, run: (c: WorkspaceContext) => Promise<T>) =>
  withWorkspace(w.owner, w.id, run);

const RULES = `- rule: Read issues
  tool: github
  operation: issues.read
  resource: { kind: issue, match: any }
  effect: allow
`;
const MORE = `${RULES}- rule: Comment on issues
  tool: github
  operation: issues.comment
  resource: { kind: issue, match: any }
  effect: deny
`;

const hex = (c: string) => c.repeat(64);
const source = (project: string, lock: string): ManagedSource => ({
  project_id: project,
  revision: hex(lock),
  policy_revision: hex("e"),
});

async function publish(
  w: TestWorkspace,
  text: string,
  managed: ManagedSource | null = null,
) {
  return act(w, async (context) => {
    const preview = await previewPolicyFile(context, ENV, text);
    return applyPolicyFile(context, ENV, text, {
      revision: preview.policyRevision,
      fileDigest: preview.fileDigest,
      managed,
    });
  });
}

const live = (w: TestWorkspace) =>
  act(w, (context) => readLiveVersion(context, ENV));

const versions = async (w: TestWorkspace) =>
  Number(
    (
      await admin.query(
        `SELECT count(*) AS n FROM nodrail.policy_versions WHERE workspace_id = $1`,
        [w.id],
      )
    )[0].n,
  );

describe("a policy published from a repository", () => {
  test("names the project and lock it came from", async () => {
    const w = await createWorkspace();
    const project = randomUUID();
    await publish(w, RULES, source(project, "a"));
    expect(await live(w)).toMatchObject({
      environment: ENV,
      managed: source(project, "a"),
    });
    expect((await live(w)).published_by).toBeTruthy();
  });

  test("the same rules and lock again change nothing", async () => {
    const w = await createWorkspace();
    const project = randomUUID();
    await publish(w, RULES, source(project, "a"));
    const before = await versions(w);
    const again = await publish(w, RULES, source(project, "a"));
    expect(again).toMatchObject({ added: 0, changed: 0, removed: 0 });
    expect(await versions(w)).toBe(before);
  });

  test("republishing adds the source to managed versions published before distribution", async () => {
    const w = await createWorkspace();
    const managed = source(randomUUID(), "a");
    await publish(w, RULES, managed);
    await admin.query(
      `UPDATE nodrail.policy_versions SET source_text = NULL, source_digest = NULL
       WHERE workspace_id = $1`,
      [w.id],
    );
    expect((await live(w)).source_digest).toBeNull();
    const before = await versions(w);
    await publish(w, RULES, managed);
    expect(await versions(w)).toBe(before + 1);
    expect((await live(w)).source_digest).toBe(
      createHash("sha256").update(RULES).digest("hex"),
    );
  });

  test("the same rules from a repository that didn't publish them are adopted as a new version", async () => {
    const w = await createWorkspace();
    await publish(w, RULES);
    expect((await live(w)).managed).toBeNull();
    const before = await versions(w);
    const project = randomUUID();
    await publish(w, RULES, source(project, "b"));
    expect(await versions(w)).toBe(before + 1);
    expect((await live(w)).managed).toEqual(source(project, "b"));
  });

  test("a new lock with the same rules is recorded, so plan stays in sync", async () => {
    const w = await createWorkspace();
    const project = randomUUID();
    await publish(w, RULES, source(project, "a"));
    await publish(w, RULES, source(project, "c"));
    expect((await live(w)).managed).toEqual(source(project, "c"));
  });

  test("an edit published elsewhere leaves the live version unmanaged: drift", async () => {
    const w = await createWorkspace();
    await publish(w, RULES, source(randomUUID(), "a"));
    await publish(w, MORE);
    expect((await live(w)).managed).toBeNull();
  });

  test("a stale console rule review is refused and ownership survives the edit", async () => {
    const w = await createWorkspace();
    const project = randomUUID();
    const create = (reviewedProjectId: string | null) =>
      act(w, (context) =>
        createRule(
          { ...context, reviewedProjectId },
          ENV,
          ruleBody({ name: "Console rule" }),
        ),
      );

    await publish(w, RULES, source(project, "a"));
    const before = await versions(w);
    await expect(create(null)).rejects.toMatchObject({
      code: "REPOSITORY_CHANGED",
    });
    expect(await versions(w)).toBe(before);

    await create(project);
    expect((await live(w)).managed).toBeNull();
    await expect(
      act(w, (context) => readRepositoryProject(context, ENV)),
    ).resolves.toMatchObject({ id: project });
    await expect(
      act(w, (context) => readRepositoryProject(context, "production")),
    ).resolves.toBeNull();
  });

  test("the database refuses a half-named source", async () => {
    const w = await createWorkspace();
    await publish(w, RULES);
    await expect(
      admin.query(
        `UPDATE nodrail.policy_versions SET managed_revision = $2 WHERE workspace_id = $1`,
        [w.id, hex("a")],
      ),
    ).rejects.toThrow(/policy_versions_managed/);
  });
});

describe("what a host's data plane fetches", () => {
  const host = async (w: TestWorkspace) =>
    issueToken(w, await createAgent(w, `host-${randomUUID().slice(0, 8)}`));
  const fetched = (token: string) =>
    withRuntime(token, "policy:read", (context) => readRuntimePolicy(context));

  test("the file apply published, with the digest a lock records for it", async () => {
    const w = await createWorkspace();
    const project = randomUUID();
    await publish(w, RULES, source(project, "a"));
    const policy = await fetched(await host(w));
    expect(policy.managed).toEqual(source(project, "a"));
    expect(policy.source).toEqual({
      text: RULES,
      digest: createHash("sha256").update(RULES).digest("hex"),
    });
  });

  test("conditional reads revalidate policy after checking the credential", async () => {
    const w = await createWorkspace();
    await publish(w, RULES, source(randomUUID(), "a"));
    const token = await host(w);
    const get = (credential: string, etag?: string) =>
      policyRoute(
        new NextRequest("http://localhost/api/v1/runtime/policy", {
          headers: {
            authorization: `Bearer ${credential}`,
            ...(etag ? { "if-none-match": etag } : {}),
          },
        }),
        { params: Promise.resolve({}) },
      );
    const first = await get(token);
    expect(first.status).toBe(200);
    const etag = first.headers.get("etag")!;
    expect(etag).toMatch(/^"[0-9a-f]{64}"$/);
    const unchanged = await get(token, etag);
    expect(unchanged.status).toBe(304);
    expect(await unchanged.text()).toBe("");
    expect((await get("invalid", etag)).status).toBe(401);
    await publish(w, MORE);
    const changed = await get(token, etag);
    expect(changed.status).toBe(200);
    expect(changed.headers.get("etag")).not.toBe(etag);
  });

  test("a version made on screen has no file for a connected host", async () => {
    const w = await createWorkspace();
    await publish(w, RULES);
    await act(w, (context) =>
      createRule(context, "development", ruleBody({ name: "Made on screen" })),
    );
    const policy = await fetched(await host(w));
    expect(policy.source).toBeNull();
    expect(policy.managed).toBeNull();
  });

  test("a credential without policy:read is refused", async () => {
    const w = await createWorkspace();
    const token = await host(w);
    await admin.query(
      `UPDATE nodrail.installation_credentials
       SET scopes = array_remove(scopes, 'policy:read')
       WHERE public_prefix = $1`,
      [token.split("_")[1]],
    );
    await expect(fetched(token)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
