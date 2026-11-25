// Published contracts, read (C06/C07): a project's bindings in its intended
// revision, one revision by digest (the full schema only for policy
// writers) and the diff between two revisions with disclosure and
// breaking changes.
import { NextRequest } from "next/server";
import { describe, expect, test } from "vitest";
import * as diffRoute from "@/app/api/v1/contracts/diff/route";
import * as bindingsRoute from "@/app/api/v1/contracts/route";
import {
  compileContracts,
  type CompiledShape,
} from "@/contracts/v1/shapes-engine";
import { readWorkspace, withWorkspace } from "@/server/db/context";
import {
  diffContracts,
  getContract,
  listContractBindings,
} from "@/server/modules/contracts/catalog";
import { publishIntendedRevision } from "@/server/modules/inventory";
import { reviewer } from "../support/contract-fixtures";
import { addMember, createWorkspace, readerToken, useDatabase } from "./world";

useDatabase();

const PROJECT_ID = "5c2a1f3e-7b8d-4c9a-8e1f-2a3b4c5d6e7f";
const FIRST = "1".repeat(64);
const SECOND = "2".repeat(64);

/** The reviewer contract, narrowed: one verdict fewer, `issue` reported. */
function narrowed(): CompiledShape {
  const compiled = compileContracts({
    manifest: {
      shapes: {
        "reviewer-result": {
          properties: {
            verdict: { values: ["ship", "fix-first"], role: "verdict" },
            issue: { type: "string", max: 100, report: true },
          },
        },
      },
      receipts: { reviewer: { shape: "reviewer-result" } },
    },
    resources: [],
  });
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.issues));
  return compiled.contracts!.shapes["reviewer-result"]!;
}

const closure = (shape: CompiledShape) => ({
  revisions: [
    {
      digest: shape.contract,
      name: "reviewer-result",
      surface: "receipt",
      dialect: 1,
      shape: shape.shape,
    },
  ],
  bindings: [
    {
      surface: "receipt",
      target: "receipt:reviewer",
      contract_digest: shape.contract,
    },
  ],
});

async function published() {
  const w = await createWorkspace();
  const later = narrowed();
  for (const [revision, shape] of [
    [FIRST, reviewer],
    [SECOND, later],
  ] as const)
    await withWorkspace(w.owner, w.id, (context) =>
      publishIntendedRevision(context, "development", {
        project_id: PROJECT_ID,
        project: "desk",
        revision,
        files: [],
        contracts: closure(shape),
      }),
    );
  return { w, later };
}

describe("contract bindings", () => {
  test("lists the intended revision's, or the one named", async () => {
    const { w, later } = await published();
    const list = (revision?: string) =>
      readWorkspace(w.owner, w.id, (context) =>
        listContractBindings(context, "development", {
          project_id: PROJECT_ID,
          ...(revision ? { revision } : {}),
        }),
      );
    expect(await list()).toEqual([
      {
        surface: "receipt",
        coverage: "S01",
        target: "receipt:reviewer",
        contract: {
          name: "reviewer-result",
          digest: later.contract,
          availability: "pinned",
        },
        projectionDigest: later.projection.digest,
      },
    ]);
    expect((await list(FIRST))[0]?.contract.digest).toBe(reviewer.contract);
    expect(await list("9".repeat(64))).toEqual([]);
  });
});

describe("one contract by digest", () => {
  test("its full schema only for people who may write policies", async () => {
    const { w } = await published();
    const owner = await readWorkspace(w.owner, w.id, (context) =>
      getContract(context, reviewer.contract),
    );
    expect(owner.contract?.shape).toEqual(reviewer.shape);
    expect(owner.projections.map((p) => p.digest)).toEqual([
      reviewer.projection.digest,
    ]);
    const viewer = await addMember(w, "viewer");
    const seen = await readWorkspace(viewer, w.id, (context) =>
      getContract(context, reviewer.projection.digest),
    );
    expect(seen.contract).toBeNull();
    expect(seen.projections[0]?.withheld).toEqual(reviewer.projection.withheld);
    await expect(
      readWorkspace(viewer, w.id, (context) =>
        getContract(context, reviewer.contract),
      ),
    ).resolves.toMatchObject({ contract: { shape: null } });
    await expect(
      readWorkspace(w.owner, w.id, (context) =>
        getContract(context, `sha256:${"e".repeat(64)}`),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("the diff between two revisions", () => {
  test("says revised, breaking, and which fields leave or stop leaving", async () => {
    const { w, later } = await published();
    const [change] = await readWorkspace(w.owner, w.id, (context) =>
      diffContracts(context, "development", {
        project_id: PROJECT_ID,
        from: FIRST,
        to: SECOND,
      }),
    );
    expect(change).toMatchObject({
      target: "receipt:reviewer",
      change: "revised",
      before: reviewer.contract,
      after: later.contract,
      compatibility: "breaking",
    });
    expect(change?.disclosure.added).toEqual(["issue"]);
    expect(change?.disclosure.removed).toEqual(
      expect.arrayContaining(["lesson", "findings.blocker"]),
    );
    // Backwards the verdicts widen, but required properties come back:
    // still breaking.
    const [back] = await readWorkspace(w.owner, w.id, (context) =>
      diffContracts(context, "development", {
        project_id: PROJECT_ID,
        from: SECOND,
        to: FIRST,
      }),
    );
    expect(back?.compatibility).toBe("breaking");
    const [same] = await readWorkspace(w.owner, w.id, (context) =>
      diffContracts(context, "development", {
        project_id: PROJECT_ID,
        from: SECOND,
        to: SECOND,
      }),
    );
    expect(same).toMatchObject({
      change: "unchanged",
      compatibility: "compatible",
    });
  });

  test("the API answers in snake case and refuses a typo", async () => {
    const { w } = await published();
    const secret = await readerToken(w);
    const get = (route: typeof diffRoute | typeof bindingsRoute, url: string) =>
      route.GET(
        new NextRequest(`http://localhost/api/v1/contracts${url}`, {
          headers: { authorization: `Bearer ${secret}` },
        }),
        { params: Promise.resolve({}) },
      );
    const ok = await get(
      diffRoute,
      `/diff?project_id=${PROJECT_ID}&from=${FIRST}&to=${SECOND}`,
    );
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { changes: Record<string, unknown>[] };
    expect(body.changes[0]).toHaveProperty("compatibility", "breaking");
    const listed = await get(bindingsRoute, `?project_id=${PROJECT_ID}`);
    const bindings = (await listed.json()) as {
      bindings: Record<string, unknown>[];
    };
    expect(bindings.bindings[0]).toHaveProperty("projection_digest");
    const typo = await get(bindingsRoute, `?projectid=${PROJECT_ID}`);
    expect(typo.status).toBe(422);
  });
});
