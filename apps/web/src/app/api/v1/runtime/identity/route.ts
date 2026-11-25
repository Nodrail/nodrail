import { readIdentity } from "@/server/modules/runtime/identity";
import { runtimeRoute } from "@/server/runtime-api";

/** Whose credential this is; changes nothing. */
export const GET = runtimeRoute("actions:read-own", (context) =>
  readIdentity(context),
);
