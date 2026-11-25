import { environmentQuery } from "@/contracts/v1/public-api";
import {
  createVerifier,
  listVerifiers,
} from "@/server/modules/evidence/verifiers";
import { publicRoute } from "@/server/public-api/route";
import { page } from "@/server/public-api/wire";

/** Evidence verifiers, revoked ones too. */
export const GET = publicRoute(
  { scope: "read", access: "read", query: environmentQuery },
  async (context) => page(await listVerifiers(context)),
);

/** Adds a GitHub Actions verifier; admins only, with `rules:write`. */
export const POST = publicRoute(
  { scope: "rules:write", access: "write", query: environmentQuery },
  (context, call) => createVerifier(context, call.body),
);
