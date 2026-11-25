// Declared contract storage: declared-contract revisions, projections, bindings and
// validated events stay inside their workspace, revisions can't be changed
// once written, a reported event can never be stored looking authoritative,
// and the migration goes down and up again cleanly on a scratch database.
import { randomBytes, randomUUID } from "node:crypto";
import { beforeAll, describe, expect, test } from "vitest";
import { Client } from "pg";
import type { EntityManager } from "typeorm";
import type { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity.js";
import { runMigrations } from "../../scripts/local-stack.mjs";
import {
  ContractBinding,
  ContractEvent,
  ContractProjection,
  ContractRevision,
} from "@/server/db/contract-entities";
import { readWorkspace, withWorkspace } from "@/server/db/context";
import { applyRetention } from "@/server/maintenance/retention";
import { removeMember } from "@/server/modules/team/members";
import {
  addMember,
  admin,
  appDirect,
  createAgent,
  createWorkspace,
  useDatabase,
  type TestAgent,
  type TestWorkspace,
} from "./world";
import {
  backendTestDatabase,
  revertMigrationsThrough,
  withScratchDatabase,
} from "../support/local-stack";

useDatabase();

/** One event row, as the application role inserts it. */
type EventRow = QueryDeepPartialEntity<ContractEvent>;

const hex = (bytes: number) => randomBytes(bytes).toString("hex");
/** An engine digest: `sha256:` and 64 hex characters. */
const sha = () => `sha256:${hex(32)}`;

let a: TestWorkspace;
let b: TestWorkspace;
let agentA: TestAgent;

beforeAll(async () => {
  a = await createWorkspace();
  b = await createWorkspace();
  agentA = await createAgent(a, "reviewer");
});

/** A full revision, its projection and one binding, in one workspace. */
async function publish(manager: EntityManager, w: TestWorkspace) {
  const contract = sha();
  const projection = sha();
  await manager.insert(ContractRevision, {
    workspaceId: w.id,
    surface: "receipt",
    digest: contract,
    name: "reviewer-result",
    dialect: 1,
    propertyCount: 5,
    schema: { properties: { verdict: { values: ["ship", "fix-first"] } } },
    registeredBy: w.owner.userId,
  });
  await manager.insert(ContractProjection, {
    workspaceId: w.id,
    surface: "receipt",
    digest: projection,
    contractDigest: contract,
    name: "reviewer-result",
    dialect: 1,
    schema: { properties: { verdict: { values: ["ship", "fix-first"] } } },
    fields: [
      {
        path: "verdict",
        type: "enum",
        values: ["ship", "fix-first"],
        optional: false,
      },
    ],
    withheld: ["issue"],
    registeredVia: "publish",
    registeredBy: w.owner.userId,
  });
  await manager.insert(ContractBinding, {
    workspaceId: w.id,
    environmentId: w.environmentId,
    projectId: randomUUID(),
    workspaceRevision: hex(32),
    surface: "receipt",
    target: "receipt:reviewer",
    contractDigest: contract,
    projectionDigest: projection,
    publishedBy: w.owner.userId,
  });
  return { contract, projection };
}

/** A local report of a valid receipt, as a reporting token stores it. */
const reported = (
  w: TestWorkspace,
  digests: { contract: string; projection: string },
): EventRow => ({
  workspaceId: w.id,
  environmentId: w.environmentId,
  authority: "reported",
  producerClass: "agent-reported",
  surface: "receipt",
  contractName: "reviewer-result",
  contractDigest: digests.contract,
  projectionDigest: digests.projection,
  userId: w.owner.userId,
  traceId: hex(16),
  spanId: hex(8),
  machine: hex(16),
  project: "acme",
  host: "claude-code",
  run: hex(16),
  agent: "reviewer",
  step: "review",
  capture: "captured",
  validation: "valid",
  validatedBy: "producer",
  projectionValidation: "valid",
  verdict: "ship",
  payload: { verdict: "ship" },
  redacted: ["issue"],
  occurredAt: new Date(),
});

/** A Cloud runtime submission the server validated against the full contract. */
const authoritative = (
  w: TestWorkspace,
  agent: TestAgent,
  digests: { contract: string; projection: string },
): EventRow => ({
  workspaceId: w.id,
  environmentId: w.environmentId,
  authority: "authoritative",
  producerClass: "runtime-observed",
  surface: "tool_result",
  contractName: "deploy-result",
  contractDigest: digests.contract,
  projectionDigest: digests.projection,
  installationId: agent.installationId,
  idempotencyKey: randomUUID(),
  actionDigest: sha(),
  agent: "reviewer",
  subjectRevision: hex(20),
  subjectSource: "runtime-observed",
  capture: "captured",
  validation: "invalid",
  validatedBy: "server",
  projectionValidation: "valid",
  execution: "succeeded",
  issues: [{ path: "status", code: "enum" }],
  issueCount: 3,
  occurredAt: new Date(),
});

const inA = <T>(run: (manager: EntityManager) => Promise<T>) =>
  withWorkspace(a.owner, a.id, ({ manager }) => run(manager));

const tables = [
  "contract_revisions",
  "contract_projections",
  "contract_bindings",
  "contract_events",
];

/** One query at a time: a transaction holds a single connection. */
async function counts(manager: EntityManager) {
  const [row]: { n: number[] }[] = await manager.query(
    `SELECT ARRAY[${tables
      .map((table) => `(SELECT count(*)::int FROM nodrail.${table})`)
      .join(", ")}] AS n`,
  );
  return row?.n;
}

describe("workspace isolation", () => {
  let digestsA: { contract: string; projection: string };

  beforeAll(async () => {
    digestsA = await inA(async (manager) => {
      const digests = await publish(manager, a);
      await manager.insert(ContractEvent, reported(a, digests));
      await manager.insert(ContractEvent, authoritative(a, agentA, digests));
      return digests;
    });
  });

  test("a workspace sees its own rows", async () => {
    expect(await inA(counts)).toEqual([1, 1, 1, 2]);
  });

  test("another workspace sees none of them", async () => {
    await withWorkspace(b.owner, b.id, async ({ manager }) => {
      expect(await counts(manager)).toEqual([0, 0, 0, 0]);
      expect(
        await manager
          .getRepository(ContractRevision)
          .findOneBy({ digest: digestsA.contract }),
      ).toBeNull();
    });
  });

  test("the screen role sees the workspace's rows and no others", async () => {
    await readWorkspace(a.owner, a.id, async ({ manager }) => {
      expect(await counts(manager)).toEqual([1, 1, 1, 2]);
    });
    await readWorkspace(b.owner, b.id, async ({ manager }) => {
      expect(await counts(manager)).toEqual([0, 0, 0, 0]);
    });
  });

  test("without a workspace, nothing", async () => {
    expect(await counts(appDirect.manager)).toEqual([0, 0, 0, 0]);
  });

  test("writing into another workspace is refused", async () => {
    await expect(
      withWorkspace(b.owner, b.id, ({ manager }) =>
        manager.insert(ContractEvent, reported(a, digestsA)),
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      withWorkspace(b.owner, b.id, ({ manager }) => publish(manager, a)),
    ).rejects.toThrow(/row-level security/);
  });

  test("the same digest in two workspaces is two revisions", async () => {
    await withWorkspace(b.owner, b.id, async ({ manager }) => {
      await manager.insert(ContractRevision, {
        workspaceId: b.id,
        surface: "receipt",
        digest: digestsA.contract,
        name: "reviewer-result",
        dialect: 1,
        propertyCount: 1,
        schema: {},
        registeredBy: b.owner.userId,
      });
    });
    expect(await inA(counts)).toEqual([1, 1, 1, 2]);
  });
});

describe("immutable revisions", () => {
  test("the application can't change or remove a revision", async () => {
    await inA(async (manager) => {
      await publish(manager, a);
    });
    for (const sql of [
      "UPDATE nodrail.contract_revisions SET name = 'other'",
      "DELETE FROM nodrail.contract_revisions",
      "UPDATE nodrail.contract_projections SET fields = '[]'",
      "UPDATE nodrail.contract_bindings SET contract_digest = repeat('0', 64)",
      "UPDATE nodrail.contract_events SET authority = 'authoritative'",
    ])
      await expect(
        inA((manager) => manager.query(sql)),
        sql,
      ).rejects.toThrow(/permission denied/);
  });

  test("one digest, one revision", async () => {
    const digests = await inA((manager) => publish(manager, a));
    await expect(
      inA((manager) =>
        manager.insert(ContractRevision, {
          workspaceId: a.id,
          surface: "receipt",
          digest: digests.contract,
          name: "reviewer-result",
          dialect: 1,
          propertyCount: 1,
          schema: {},
          registeredBy: a.owner.userId,
        }),
      ),
    ).rejects.toMatchObject({ code: "ALREADY_EXISTS" });
  });
});

describe("reported never looks authoritative", () => {
  let digests: { contract: string; projection: string };
  beforeAll(async () => {
    digests = await inA((manager) => publish(manager, a));
  });

  const refused = (event: EventRow) =>
    expect(
      inA((manager) => manager.insert(ContractEvent, event)),
    ).rejects.toThrow(/violates check constraint/);

  test.each([
    ["claims the server validated it", { validatedBy: "server" as const }],
    ["claims external verification", { producerClass: "externally-verified" }],
    ["claims a person signed in", { producerClass: "person-authenticated" }],
    ["uses the earlier spelling", { producerClass: "agent_reported" }],
    [
      "claims an externally verified subject",
      { subjectRevision: "a".repeat(40), subjectSource: "externally-verified" },
    ],
    ["is bound to an action", { actionDigest: `sha256:${"a".repeat(64)}` }],
    ["names an installation credential", { idempotencyKey: "k" }],
  ])("a reported event that %s", async (_, change) => {
    await refused({ ...reported(a, digests), ...change });
  });

  test("an authoritative event can't carry a reporter or span", async () => {
    await refused({
      ...authoritative(a, agentA, digests),
      userId: a.owner.userId,
    });
    await refused({
      ...authoritative(a, agentA, digests),
      traceId: hex(16),
      spanId: hex(8),
    });
    await refused({
      ...authoritative(a, agentA, digests),
      validatedBy: "producer",
    });
  });

  test.each([
    [
      "a verdict on an invalid receipt",
      { validation: "invalid" as const, issueCount: 1 },
    ],
    ["a valid receipt with issues", { issueCount: 1 }],
    [
      "an invalid receipt without issues",
      { validation: "invalid" as const, verdict: null },
    ],
    ["a missing receipt with a validation", { capture: "missing" as const }],
    ["an execution outcome on a receipt", { execution: "succeeded" }],
    ["a payload over 8 KiB", { payload: { note: "x".repeat(8200) } }],
    [
      "more than 20 stored issues",
      {
        validation: "invalid" as const,
        verdict: null,
        issueCount: 21,
        issues: Array.from({ length: 21 }, () => ({
          path: "a",
          code: "type" as const,
        })),
      },
    ],
    ["a short digest", { contractDigest: "abc" }],
    ["a digest without its sha256: prefix", { contractDigest: hex(32) }],
    [
      "a findings count on an invalid receipt",
      {
        validation: "invalid" as const,
        verdict: null,
        issueCount: 1,
        findingsCount: 2,
      },
    ],
  ])("the table refuses %s", async (_, change) => {
    await refused({ ...reported(a, digests), ...change });
  });

  test("a missing receipt is stored without states or payload", async () => {
    await inA((manager) =>
      manager.insert(ContractEvent, {
        ...reported(a, digests),
        capture: "missing",
        validation: null,
        validatedBy: null,
        projectionDigest: null,
        projectionValidation: null,
        verdict: null,
        payload: {},
        redacted: [],
      }),
    );
  });

  test("a span is kept once", async () => {
    const event = reported(a, digests);
    await inA((manager) => manager.insert(ContractEvent, event));
    await expect(
      inA((manager) =>
        manager.insert(ContractEvent, { ...event, id: undefined }),
      ),
    ).rejects.toMatchObject({ code: "ALREADY_EXISTS" });
  });
});

describe("retention", () => {
  test("a revision stays while an event names it, then goes", async () => {
    const digests = await inA((manager) => publish(manager, a));
    const named = await inA(async (manager) => {
      const kept = await publish(manager, a);
      await manager.insert(ContractEvent, reported(a, kept));
      return kept;
    });
    // Two years ago, for both closures and their bindings.
    await admin.query(
      `UPDATE nodrail.contract_revisions SET created_at = now() - interval '2 years'
       WHERE workspace_id = $1 AND digest = ANY($2)`,
      [a.id, [digests.contract, named.contract]],
    );
    await admin.query(
      `UPDATE nodrail.contract_projections SET created_at = now() - interval '2 years'
       WHERE workspace_id = $1 AND digest = ANY($2)`,
      [a.id, [digests.projection, named.projection]],
    );
    await admin.query(
      `DELETE FROM nodrail.contract_bindings
       WHERE workspace_id = $1 AND contract_digest = ANY($2)`,
      [a.id, [digests.contract, named.contract]],
    );
    await applyRetention();
    const left = async (table: string, digest: string) =>
      (
        await admin.query(
          `SELECT 1 FROM nodrail.${table} WHERE workspace_id = $1 AND digest = $2`,
          [a.id, digest],
        )
      ).length;
    expect(await left("contract_revisions", digests.contract)).toBe(0);
    expect(await left("contract_projections", digests.projection)).toBe(0);
    expect(await left("contract_revisions", named.contract)).toBe(1);
    expect(await left("contract_projections", named.projection)).toBe(1);
  });
});

describe("a person's reports leave with them", () => {
  test("removing a member removes their reported events", async () => {
    const person = await addMember(a, "viewer");
    const digests = await inA((manager) => publish(manager, a));
    await inA((manager) =>
      manager.insert(ContractEvent, {
        ...reported(a, digests),
        userId: person.userId,
      }),
    );
    await withWorkspace(a.owner, a.id, (context) =>
      removeMember(context, person.userId),
    );
    const [row] = await admin.query(
      "SELECT count(*)::int AS n FROM nodrail.contract_events WHERE workspace_id = $1 AND user_id = $2",
      [a.id, person.userId],
    );
    expect(row.n).toBe(0);
  });
});

describe("migration", () => {
  /** The declared-contract tables, and whether row security binds each. */
  const inspect = async (url: string) => {
    const client = new Client({ connectionString: url });
    await client.connect();
    try {
      const { rows } = await client.query<{ forced: boolean }>(
        `SELECT relrowsecurity AND relforcerowsecurity AS forced
         FROM pg_class
         WHERE relnamespace = 'nodrail'::regnamespace AND relname = ANY($1)`,
        [tables],
      );
      return rows.map((row) => row.forced);
    } finally {
      await client.end();
    }
  };

  test(
    "goes down and up again on a database of its own",
    () =>
      withScratchDatabase(
        `${backendTestDatabase().database}_updown`,
        async (urls) => {
          expect(await inspect(urls.admin)).toEqual([true, true, true, true]);
          revertMigrationsThrough(urls.owner, "DeclaredContracts");
          expect(await inspect(urls.admin)).toEqual([]);
          runMigrations(urls.owner);
          expect(await inspect(urls.admin)).toEqual([true, true, true, true]);
        },
      ),
    120_000,
  );

  /** Rows in their persisted shape, written past keys and row security. */
  const earlierRows = async (url: string) => {
    const client = new Client({ connectionString: url });
    await client.connect();
    const [w, u, e, i] = [
      randomUUID(),
      randomUUID(),
      randomUUID(),
      randomUUID(),
    ];
    const d = (c: string) => c.repeat(64);
    try {
      await client.query("SET session_replication_role = replica");
      await client.query(
        `INSERT INTO nodrail.contract_revisions
           (workspace_id, surface, digest, name, dialect, property_count, schema, registered_by)
         VALUES ($1, 'receipt', $2, 'reviewer-result', 'shapes/v1', 1, '{}', $3)`,
        [w, d("a"), u],
      );
      await client.query(
        `INSERT INTO nodrail.contract_projections
           (workspace_id, surface, digest, contract_digest, name, dialect, version, schema, fields, registered_via, registered_by)
         VALUES ($1, 'receipt', $2, $3, 'reviewer-result', 'shapes/v1', 1, '{}', '[]', 'report', $4)`,
        [w, d("b"), d("a"), u],
      );
      await client.query(
        `INSERT INTO nodrail.contract_bindings
           (workspace_id, environment_id, project_id, workspace_revision, surface, target, contract_digest, projection_digest, published_by)
         VALUES ($1, $2, $3, $4, 'receipt', 'agent:reviewer', $5, $6, $7)`,
        [w, e, randomUUID(), d("c"), d("a"), d("b"), u],
      );
      await client.query(
        `INSERT INTO nodrail.contract_events
           (workspace_id, environment_id, authority, producer_class, surface, contract_name, contract_digest, projection_digest,
            installation_id, idempotency_key, action_digest, subject_revision, subject_source, capture, validation,
            validated_by, projection_validation, occurred_at)
         VALUES ($1, $2, 'authoritative', 'runtime_observed', 'receipt', 'reviewer-result', $3, $4, $5, 'k', $6,
                 $7, 'externally_verified', 'captured', 'valid', 'server', 'valid', now())`,
        [w, e, d("a"), d("b"), i, d("d"), "e".repeat(40)],
      );
    } finally {
      await client.end();
    }
  };

  const snapshot = async (url: string) => {
    const client = new Client({ connectionString: url });
    await client.connect();
    try {
      const one = async (sql: string) => (await client.query(sql)).rows[0];
      return {
        revision: await one(
          "SELECT digest, dialect FROM nodrail.contract_revisions",
        ),
        projection: await one(
          "SELECT digest, contract_digest, dialect FROM nodrail.contract_projections",
        ),
        binding: await one(
          "SELECT target, contract_digest FROM nodrail.contract_bindings",
        ),
        event: await one(
          "SELECT producer_class, subject_source, action_digest FROM nodrail.contract_events",
        ),
      };
    } finally {
      await client.end();
    }
  };

  test(
    "upgrades rows written before the grammar froze, and downgrades them back",
    () =>
      withScratchDatabase(
        `${backendTestDatabase().database}_upgrade`,
        async (urls) => {
          revertMigrationsThrough(urls.owner, "ContractGrammar");
          await earlierRows(urls.admin);
          const before = await snapshot(urls.admin);
          runMigrations(urls.owner);
          const sha = (c: string) => `sha256:${c.repeat(64)}`;
          expect(await snapshot(urls.admin)).toEqual({
            revision: { digest: sha("a"), dialect: 1 },
            projection: {
              digest: sha("b"),
              contract_digest: sha("a"),
              dialect: 1,
            },
            binding: { target: "receipt:reviewer", contract_digest: sha("a") },
            event: {
              producer_class: "runtime-observed",
              subject_source: "externally-verified",
              action_digest: sha("d"),
            },
          });
          revertMigrationsThrough(urls.owner, "ContractGrammar");
          expect(await snapshot(urls.admin)).toEqual(before);
          runMigrations(urls.owner);
        },
      ),
    120_000,
  );
});
