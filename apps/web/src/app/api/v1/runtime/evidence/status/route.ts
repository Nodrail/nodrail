import { runtimeEvidenceStatus } from "@/server/modules/evidence/status";
import { runtimeRoute } from "@/server/runtime-api";

/**
 * `GET /evidence/status` for a host's own credential (`evidence:read`):
 * the same answer as the public endpoint, for the credential's environment.
 * It changes nothing and returns no evidence value.
 */
export const GET = runtimeRoute("evidence:read", (context, call) =>
  runtimeEvidenceStatus(
    context,
    Object.fromEntries(call.request.nextUrl.searchParams),
  ),
);
