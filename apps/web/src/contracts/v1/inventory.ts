import { z } from "zod";
import { contractClosureInput } from "./declared-contracts";
import { evidenceClosureInput } from "./evidence";

/** A report older than this is stale: no session there in a day. */
export const INVENTORY_STALE_MS = 24 * 60 * 60 * 1000;

/** Spans one export may carry; the rest is rejected. */
export const MAX_SPANS_PER_EXPORT = 200;

/** An OTLP body, at most. */
export const MAX_OTLP_BODY_BYTES = 512 * 1024;

const count = z
  .string()
  .regex(/^\d{1,6}$/)
  .transform(Number)
  .pipe(z.number().int().max(100_000));
const revision = z
  .string()
  .regex(/^[0-9a-f]{64}$/)
  .optional();
const nameList = z
  .string()
  .max(4000)
  .transform((text, check) => {
    try {
      return z.array(z.string().max(500)).max(500).parse(JSON.parse(text));
    } catch {
      check.addIssue({ code: "custom", message: "not a list of names" });
      return z.NEVER;
    }
  })
  .optional();

/** A `nodrail.observation` span's attributes, as `nodrail observe` sends them. */
export const observationAttributes = z.object({
  "nodrail.machine": z.string().regex(/^[0-9a-f]{32}$/),
  "nodrail.host": z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
  "nodrail.agent": z.string().min(1).max(200).optional(),
  "nodrail.activation": z.enum([
    "verified",
    "configured",
    "inactive",
    "unknown",
  ]),
  "nodrail.in_step": z.enum(["true", "false"]).transform((v) => v === "true"),
  "nodrail.drift": count,
  "nodrail.workspace.revision": revision,
  "nodrail.workspace.locked": revision,
  "nodrail.drift.names": nameList,
  "nodrail.unmanaged.names": nameList,
});

/** `nodrail.unmanaged.<kind>` counts, by kind. */
export const UNMANAGED_PREFIX = "nodrail.unmanaged.";
export const unmanagedKind = /^[a-z][a-z_]{0,39}$/;

const digest = z.string().regex(/^[0-9a-f]{64}$/);

/** What `nodrail workspace publish` sends: the lock's revision and files. */
export const publishRevisionInput = z
  .object({
    /** The project's stable id: a revision is never published by name. */
    project_id: z.uuid(),
    project: z.string().min(1).max(200),
    revision: digest,
    policy_revision: digest.nullable().default(null),
    files: z
      .array(
        z
          .object({
            path: z
              .string()
              .min(1)
              .max(500)
              .refine(
                (path) =>
                  !path.startsWith("/") && !path.split("/").includes(".."),
                "a path inside the project",
              ),
            sha256: digest,
          })
          .strict(),
      )
      .max(2000),
    /** The lock's declared contracts; absent from clients without them. */
    contracts: contractClosureInput.optional(),
    /** Its evidence bindings' verifiers and gate requirements. */
    evidence: evidenceClosureInput.optional(),
  })
  .strict()
  .refine((input) => !input.evidence || input.contracts, {
    path: ["evidence"],
    message: "evidence comes with the contracts that bind it",
  });

export type IntendedRevisionDto = {
  projectId: string;
  project: string;
  revision: string;
  policyRevision: string | null;
  files: { path: string; sha256: string }[];
  publishedBy: string;
  publishedAt: string;
};

export type InventoryRowDto = {
  person: string;
  mine: boolean;
  /** The machine's random id, shortened for display. */
  machine: string;
  project: string;
  /** False for a report without a project id: shown by name, never joined. */
  projectBound: boolean;
  host: string;
  agent: string | null;
  activation: "verified" | "configured" | "inactive" | "unknown";
  inStep: boolean;
  drift: number;
  unmanaged: Record<string, number>;
  names: { drift: string[]; unmanaged: string[] } | null;
  appliedRevision: string | null;
  lockedRevision: string | null;
  observedAt: string;
  stale: boolean;
  /** The revision the team published for this project here, if any. */
  intendedRevision: string | null;
  /** Applied from another revision than the intended one. */
  behind: boolean;
};

export type InventoryDto = {
  rows: InventoryRowDto[];
  /** Whether the person sees everyone's machines or only their own. */
  seesEveryone: boolean;
  /**
   * Each state apart, as reported by the installations themselves: no count
   * stands for confirmed enforcement. Stale reports are counted only as
   * stale.
   */
  summary: {
    reports: number;
    /** The host itself said it runs the hook (a local check). */
    verified: number;
    /** The hook is set up; whether the host runs it is unknown. */
    configured: number;
    /** The hook doesn't run. */
    inactive: number;
    /** The installation couldn't tell. */
    unknown: number;
    stale: number;
    drifted: number;
    behind: number;
  };
};
