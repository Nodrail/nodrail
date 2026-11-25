import "server-only";
import type { NextRequest } from "next/server";
import type { z } from "zod";
import { MAX_API_BODY_BYTES } from "@/contracts/v1/api-tokens";
import { AppError, parseInput, type HumanPrincipal } from "@/server/db/context";
import { answer, readBody } from "@/server/http/api";
import { currentApiSession } from "./session";
import { toWire } from "./wire";

export const sessionRoute =
  <Schema extends z.ZodType>(
    schema: Schema,
    handler: (
      principal: HumanPrincipal,
      input: z.infer<Schema>,
    ) => Promise<unknown>,
  ) =>
  (request: NextRequest) =>
    answer("Management API", async () => {
      const principal = await currentApiSession(request);
      const query = request.nextUrl.searchParams;
      if (
        new Set(query.keys()).size !== query.size ||
        (request.method !== "GET" && query.size > 0)
      )
        throw new AppError("INVALID_INPUT");
      const input = parseInput(
        schema,
        request.method === "GET"
          ? Object.fromEntries(query)
          : await readBody(request, MAX_API_BODY_BYTES),
      );
      return toWire(await handler(principal, input));
    });
