import type { z } from "zod";
import type { ApiTokenScope } from "@/contracts/v1/api-tokens";
import type { RuntimeScope } from "@/server/db/context";

export type Auth =
  | "public"
  | "session"
  | "workspaceSession"
  | "github"
  | { management: ApiTokenScope; bearerOnly?: boolean }
  | { runtime: RuntimeScope };

export type Operation = {
  method: "get" | "post" | "patch" | "delete";
  path: string;
  summary: string;
  auth: Auth;
  query?: z.ZodType;
  body?: z.ZodType;
  result?: z.ZodType;
  headers?: Record<string, z.ZodType>;
  protobuf?: boolean;
};

export function operation(
  method: Operation["method"],
  path: string,
  summary: string,
  options: Omit<Operation, "method" | "path" | "summary">,
): Operation {
  return { method, path, summary, ...options };
}
