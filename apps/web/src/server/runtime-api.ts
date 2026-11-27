import "server-only";
import type { NextRequest, NextResponse } from "next/server";
import { MAX_RUNTIME_BODY_BYTES } from "@/contracts/v1/runtime";
import {
  withRuntime,
  type RuntimeContext,
  type RuntimeScope,
} from "@/server/db/context";
import { answer, bearerToken, readBody } from "@/server/http/api";

/**
 * Every runtime endpoint: authenticate, check scope, run, answer in one shape.
 * Nothing but a body with code "ALLOW" means a tool may run.
 */
export function runtimeRoute<Params = object>(
  scope: RuntimeScope | readonly RuntimeScope[],
  handler: (
    context: RuntimeContext,
    call: { body: unknown; request: NextRequest; params: Params },
  ) => Promise<unknown>,
  mode?: "disconnect",
) {
  return (
    request: NextRequest,
    segment: { params: Promise<Params> },
  ): Promise<NextResponse> =>
    answer("Host API", async () => {
      const token = bearerToken(request);
      const body = await readBody(request, MAX_RUNTIME_BODY_BYTES);
      const params = await segment.params;
      return withRuntime(
        token,
        scope,
        (context) => handler(context, { body, request, params }),
        mode,
      );
    });
}
