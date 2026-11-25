import "server-only";
import { capabilitiesFor, type Role } from "@/contracts/v1/access";
import { AppError, type WorkspaceContext } from "@/server/db/context";

export function canGrantRole(context: WorkspaceContext, role: Role) {
  return capabilitiesFor(role, false).every((capability) =>
    context.capabilities.has(capability),
  );
}

export function requireRoleGrant(context: WorkspaceContext, role: Role) {
  if (!canGrantRole(context, role))
    throw new AppError(
      "tokenId" in context.principal ? "INSUFFICIENT_SCOPE" : "FORBIDDEN",
      "Granting this role requires all of its capabilities.",
    );
}
