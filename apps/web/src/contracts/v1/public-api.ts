import { z } from "zod";
import {
  activityKinds,
  activityRanges,
  checkToken,
  outcomeFilters,
} from "./activity-query";
import { contractEventsQuery } from "./contract-reads";
import { contractSurfaces } from "./declared-contracts";
import { POLICY_FILE_MAX_BYTES } from "./policies";

/**
 * The personal API's queries and bodies. Unlike a page's URL, where anything
 * unrecognised means "no filter", a script's typo is refused, so a filter it
 * meant to apply is never silently dropped.
 */
const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/);

const apiQuery = <T extends z.ZodRawShape>(shape: T) =>
  z.object({ environment: slug.optional(), ...shape }).strict();

const limit = z.coerce.number().int().min(1).max(100).default(50);
const cursor = z.string().min(1).max(200).optional();
const search = {
  q: z.string().trim().max(200).optional(),
  agent: z.string().trim().max(100).optional(),
  outcome: z.enum(outcomeFilters).optional(),
  range: z.enum(activityRanges).optional(),
};

export const environmentQuery = apiQuery({});

/** Declared-contract events, in the environment they're read in. */
export const contractEventsApiQuery = contractEventsQuery.extend({
  environment: slug.optional(),
});

export const revisionQuery = apiQuery({ project_id: z.uuid() });

/** A published workspace revision: the lock's digest. */
const workspaceRevision = z.string().regex(/^[0-9a-f]{64}$/);
export const liveRulesQuery = apiQuery({
  workspace_revision: workspaceRevision.optional(),
});

/** A project's contract bindings: its intended revision, or the one named. */
export const contractsQuery = apiQuery({
  project_id: z.uuid(),
  revision: workspaceRevision.optional(),
});

/** One contract or projection revision, optionally on one surface. */
export const contractQuery = apiQuery({
  surface: z.enum(contractSurfaces).optional(),
});

/** What changes between two published revisions of a project. */
export const contractDiffQuery = apiQuery({
  project_id: z.uuid(),
  from: workspaceRevision,
  to: workspaceRevision,
});

export const activityApiQuery = apiQuery({
  ...search,
  kind: z.enum(activityKinds).optional(),
  check_token: checkToken.optional(),
  run: z.uuid().optional(),
  cursor,
  limit,
});

export const runsApiQuery = apiQuery({ ...search, cursor, limit });

export const insightsQuery = apiQuery({
  days: z
    .enum(["7", "30", "90"])
    .default("30")
    .transform((days) => Number(days) as 7 | 30 | 90),
});

export const decisionBody = z
  .object({
    decision: z.enum(["allow_once", "deny"]),
    expected_action_digest: z.string().min(1).max(128),
  })
  .strict();

// One decoded byte can take up to six bytes in a JSON string.
export const MAX_POLICY_JSON_BYTES = POLICY_FILE_MAX_BYTES * 6 + 4096;
const rulesFile = z.string().max(POLICY_FILE_MAX_BYTES);

export const previewBody = z.object({ yaml: rulesFile }).strict();

/** The repository project and lock a publish comes from, as apply sends it. */
export const managedSource = z
  .object({
    project_id: z.uuid(),
    revision: workspaceRevision,
    policy_revision: workspaceRevision.nullable(),
  })
  .strict();
export type ManagedSource = z.infer<typeof managedSource>;

export const publishBody = z
  .object({
    yaml: rulesFile,
    policy_revision: z.number().int().min(0),
    file_digest: z
      .string()
      .min(1)
      .max(128)
      .describe(
        "Digest returned by preview, bound to the YAML and its environment.",
      ),
    managed: managedSource.optional(),
    reviewed_project_id: z.uuid().nullable().optional(),
  })
  .strict();

export const activityExportBody = activityApiQuery.omit({
  environment: true,
  cursor: true,
  limit: true,
});
