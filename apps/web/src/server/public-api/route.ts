import "server-only";
import type { NextRequest } from "next/server";
import type { z } from "zod";
import {
  MAX_API_BODY_BYTES,
  scopeCapability,
  type ApiTokenScope,
} from "@/contracts/v1/api-tokens";
import {
  AppError,
  parseInput,
  readWorkspace,
  requireCapability,
  withWorkspace,
  type WorkspaceContext,
} from "@/server/db/context";
import { findMyWorkspaceId } from "@/server/modules/workspaces";
import { currentApiSession } from "./session";
import {
  withPersonalToken,
  type ApiAccess,
  type TokenContext,
} from "@/server/db/token-context";
import { answer, bearerToken, readBody } from "@/server/http/api";
import { environmentQuery } from "@/contracts/v1/public-api";
import { noInput } from "@/contracts/v1/management";
import { page, toWire } from "./wire";

type QuerySchema = z.ZodType<{ environment?: string | undefined }>;

export type ApiCall<Params, Query> = {
  body: unknown;
  params: Params;
  query: Query;
  /** The environment asked for, or the workspace's default one. */
  environment: string;
};

/** Each name once: a repeated parameter is a mistake, not a choice. */
function readQuery(searchParams: URLSearchParams, schema: QuerySchema) {
  const keys = [...searchParams.keys()];
  if (new Set(keys).size !== keys.length) throw new AppError("INVALID_INPUT");
  return parseInput(schema, Object.fromEntries(searchParams));
}

/** The workspace's default environment, for a call that names none. */
export async function defaultEnvironment(context: WorkspaceContext) {
  const [row]: { slug: string }[] = await context.manager.query(
    `SELECT e.slug FROM nodrail.workspaces w
     JOIN nodrail.environments e
       ON e.workspace_id = w.id AND e.id = w.default_environment_id
     WHERE w.id = $1`,
    [context.workspaceId],
  );
  if (!row) throw new AppError("NOT_FOUND");
  return row.slug;
}

type RouteNeeds<Schema> = {
  scope: ApiTokenScope;
  access: ApiAccess;
  query: Schema;
  maxBodyBytes?: number;
};

type WorkspaceHandler<Params, Schema extends QuerySchema, Context> = (
  context: Context,
  call: ApiCall<Params, z.infer<Schema>>,
) => Promise<unknown>;

function workspaceRoute<
  Params,
  Schema extends QuerySchema,
  Context extends WorkspaceContext,
>(
  needs: RouteNeeds<Schema>,
  handler: WorkspaceHandler<Params, Schema, Context>,
  enter: (
    request: NextRequest,
    prepare: (
      searchParams: URLSearchParams,
    ) => Promise<(context: Context) => Promise<unknown>>,
  ) => Promise<unknown>,
) {
  return (request: NextRequest, segment: { params: Promise<Params> }) =>
    answer("Management API", async () =>
      toWire(
        await enter(request, async (searchParams) => {
          const query = readQuery(searchParams, needs.query) as z.infer<Schema>;
          const body = await readBody(
            request,
            needs.maxBodyBytes ?? MAX_API_BODY_BYTES,
          );
          const params = await segment.params;
          return async (context) => {
            requireCapability(context, scopeCapability[needs.scope]);
            const result = await handler(context, {
              body,
              params,
              query,
              environment:
                query.environment ?? (await defaultEnvironment(context)),
            });
            return result === undefined ? { ok: true } : result;
          };
        }),
      ),
    );
}

export function tokenRoute<
  Params = object,
  Schema extends QuerySchema = QuerySchema,
>(
  needs: RouteNeeds<Schema>,
  handler: WorkspaceHandler<Params, Schema, TokenContext>,
) {
  return workspaceRoute(needs, handler, (request, prepare) =>
    enterBearerWorkspace(request, needs, prepare),
  );
}

async function enterBearerWorkspace<T>(
  request: NextRequest,
  needs: RouteNeeds<QuerySchema>,
  prepare: (
    searchParams: URLSearchParams,
  ) => Promise<(context: TokenContext) => Promise<T>>,
) {
  const token = bearerToken(request);
  const run = await prepare(request.nextUrl.searchParams);
  return withPersonalToken(token, needs, run);
}

type RouteAuth = "either" | "session";

/** Use the same workspace context and row visibility as the console. */
export function publicRoute<
  Params = object,
  Schema extends QuerySchema = QuerySchema,
>(
  needs: RouteNeeds<Schema> & { auth?: RouteAuth },
  handler: WorkspaceHandler<Params, Schema, WorkspaceContext>,
) {
  return workspaceRoute(needs, handler, async (request, prepare) => {
    if (
      request.headers.has("authorization") ||
      !request.headers.has("cookie")
    ) {
      if (needs.auth === "session") throw new AppError("UNAUTHENTICATED");
      return enterBearerWorkspace(request, needs, prepare);
    }
    const principal = await currentApiSession(request);
    const query = request.nextUrl.clone();
    const [slug, ...repeated] = query.searchParams.getAll("workspace");
    if (!slug || repeated.length) throw new AppError("INVALID_INPUT");
    query.searchParams.delete("workspace");
    const run = await prepare(query.searchParams);
    const workspaceId = await findMyWorkspaceId(principal, slug);
    const enter = needs.access === "read" ? readWorkspace : withWorkspace;
    return enter(principal, workspaceId, run);
  });
}

/** A read-only list of the environment's records, as one page. */
export const environmentList = <T>(
  list: (context: WorkspaceContext, environment: string) => Promise<T[]>,
) =>
  publicRoute(
    { scope: "read", access: "read", query: environmentQuery },
    async (context, call) => page(await list(context, call.environment)),
  );

/** An action identified by a route id, with no extra input beyond a JSON object. */
export function idAction(
  scope: ApiTokenScope,
  action: (context: WorkspaceContext, id: string) => Promise<unknown>,
  auth?: RouteAuth,
) {
  return publicRoute<{ id: string }>(
    { scope, auth, access: "write", query: environmentQuery },
    (context, call) => {
      parseInput(noInput, call.body);
      return action(context, call.params.id);
    },
  );
}
