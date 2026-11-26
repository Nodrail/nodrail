import { z } from "zod";

export const challengeSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const cliStart = z
  .object({ challenge: challengeSchema, origin: z.string() })
  .strict();
export const cliExchange = z
  .object({
    verifier: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    origin: z.string(),
  })
  .strict();
