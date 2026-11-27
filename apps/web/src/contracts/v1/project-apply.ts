import { z } from "zod";
import { publishRevisionInput } from "./inventory";
import { managedSource, previewBody, publishBody } from "./public-api";

export const declarations = z
  .object({
    project_id: z.uuid(),
    agents: z
      .array(
        z
          .object({
            key: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/),
            description: z.string().max(200).nullable(),
          })
          .strict(),
      )
      .max(200),
  })
  .strict()
  .refine(
    ({ agents }) =>
      new Set(agents.map(({ key }) => key)).size === agents.length,
  );

export const projectPreviewBody = previewBody
  .extend({
    declarations: declarations.optional(),
    intended: publishRevisionInput.optional(),
  })
  .refine(({ declarations, intended }) => !intended || !!declarations, {
    path: ["declarations"],
    message: "An intended revision needs its declarations.",
  });

const machine = z
  .object({
    id: z.uuid(),
    runtime: z.enum(["claude-code", "codex", "copilot"]),
    credential: z
      .string()
      .regex(/^ndr_[0-9a-f]{12}_[A-Za-z0-9_-]{43}$/)
      .optional(),
  })
  .strict();

export const enrollmentBody = z
  .object({ project_id: z.uuid(), machine })
  .strict();

export const projectApplyBody = publishBody
  .omit({ managed: true, file_digest: true })
  .extend({
    file_digest: publishBody.shape.file_digest.optional(),
    replace_live: z.boolean().optional(),
    intended: publishRevisionInput,
    declarations,
    machine: machine
      .extend({
        proposed_credential: z
          .object({
            prefix: z.string().regex(/^[a-f0-9]{12}$/),
            digest: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict()
          .optional(),
        expected_credential: z
          .string()
          .regex(/^[a-f0-9]{12}$/)
          .nullable(),
      })
      .optional(),
  })
  .strict();

export type Declarations = z.infer<typeof declarations>;
export type Machine = z.infer<typeof machine>;
export type ProjectApply = z.infer<typeof projectApplyBody>;

export function managedOf(intended: ProjectApply["intended"]) {
  const { project_id, revision, policy_revision } = intended;
  return managedSource.parse({ project_id, revision, policy_revision });
}

export const projectAccess = z.discriminatedUnion("action", [
  z
    .object({
      action: z.enum(["grant-apply", "revoke-apply"]),
      project_id: z.uuid(),
      user_id: z.uuid(),
    })
    .strict(),
  z
    .object({
      action: z.literal("bind-agent"),
      project_id: z.uuid(),
      agent: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/),
    })
    .strict(),
]);
export type ProjectAccess = z.infer<typeof projectAccess>;

export const enrollmentReconcileBody = z
  .object({
    project_id: z.uuid(),
    machine_id: z.uuid(),
    generation: z.string().regex(/^[a-f0-9]{12}$/),
  })
  .strict();
