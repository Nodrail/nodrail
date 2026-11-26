import "server-only";
import {
  apiTokenScopes,
  scopeCapability,
  type ApiTokenScope,
} from "@/contracts/v1/api-tokens";
import {
  AppError,
  withWorkspace,
  type HumanPrincipal,
} from "@/server/db/context";
import type { ApiAccess, TokenContext } from "@/server/db/token-context";
import {
  findMyWorkspaceId,
  listMyWorkspaces,
} from "@/server/modules/workspaces";

export async function cliTokenContext<T>(
  principal: HumanPrincipal,
  slug: string | undefined,
  needs: {
    access: ApiAccess;
    scope: ApiTokenScope;
    allowFirstWorkspace: boolean;
  },
  run: (context: TokenContext) => Promise<T>,
) {
  const workspaceId = slug
    ? await findMyWorkspaceId(principal, slug)
    : await workspaceForCli(principal, needs.allowFirstWorkspace);
  return withWorkspace(principal, workspaceId, async (member) => {
    const scopes = apiTokenScopes.filter(
      (scope) =>
        scope !== "inventory:write" &&
        member.capabilities.has(scopeCapability[scope]),
    );
    if (!scopes.includes(needs.scope))
      throw new AppError("INSUFFICIENT_SCOPE", `Requires ${needs.scope}.`);
    const [session]: { created_at: Date; expires_at: Date }[] =
      await member.manager.query(
        "SELECT created_at, expires_at FROM nodrail.human_sessions WHERE id = $1",
        [principal.sessionId],
      );
    if (!session) throw new AppError("UNAUTHENTICATED");
    if (needs.access === "read")
      await member.manager.query("SET LOCAL ROLE nodrail_member_read");
    return run({
      ...member,
      token: {
        id: principal.sessionId,
        name: "CLI session",
        prefix: "ndc_",
        scopes,
        createdAt: session.created_at,
        expiresAt: session.expires_at,
        lastUsedAt: null,
      },
    });
  });
}

async function workspaceForCli(principal: HumanPrincipal, allowFirst: boolean) {
  const [workspace, next] = await listMyWorkspaces(principal);
  if (!workspace)
    throw new AppError("NOT_FOUND", "Create or join a workspace in Nodrail.");
  if (next && !allowFirst)
    throw new AppError(
      "INVALID_INPUT",
      "Choose a workspace with --workspace <slug> or set connect.workspace in nodrail.yaml.",
    );
  return workspace.id;
}
