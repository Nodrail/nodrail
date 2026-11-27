import { z } from "zod";
import { policyDigest, runtimeAgent } from "./runtime";
import { unmanagedKind } from "./inventory";

const names = z.array(z.string().min(1).max(200)).max(20);
const base = z.object({
  host: z.enum(["claude-code", "codex", "copilot"]),
  agent: runtimeAgent,
  applied_revision: policyDigest.nullable(),
  locked_revision: policyDigest.nullable(),
});
const observation = base
  .extend({
    in_step: z.boolean(),
    activation: z.enum(["verified", "configured", "inactive", "unknown"]),
    drift: z.number().int().min(0).max(100_000),
    unmanaged: z
      .record(
        z.string().regex(unmanagedKind),
        z.number().int().min(0).max(999_999),
      )
      .refine((counts) => Object.keys(counts).length <= 20),
    names: z
      .object({ drift: names, unmanaged: names })
      .strict()
      .refine((value) => Buffer.byteLength(JSON.stringify(value)) <= 8000)
      .optional(),
  })
  .strict();
export const hostObservationInput = z.union([
  observation,
  base
    .partial({ applied_revision: true, locked_revision: true })
    .extend({ heartbeat: z.literal(true) })
    .strict(),
]);
