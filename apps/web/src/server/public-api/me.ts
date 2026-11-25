import "server-only";
import { z } from "zod";
import { roles } from "@/contracts/v1/access";
import { scopeCapability } from "@/contracts/v1/api-tokens";
import { AppError, parseRows } from "@/server/db/context";
import type { TokenContext } from "@/server/db/token-context";

const workspaceRow = z.object({
  person: z.string(),
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  default_environment_id: z.uuid().nullable(),
});

const environmentRow = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
});

/** The token, its person and workspace, and what it can do right now. */
export async function describeToken(context: TokenContext) {
  const { manager, workspaceId, principal, token } = context;
  const [workspace] = parseRows(
    workspaceRow,
    await manager.query(
      `SELECT u.display_name AS person, w.id, w.name, w.slug,
              w.default_environment_id
       FROM nodrail.workspaces w, nodrail.users u
       WHERE w.id = $1 AND u.id = $2`,
      [workspaceId, principal.userId],
    ),
  );
  if (!workspace) throw new AppError("NOT_FOUND");
  const environments = parseRows(
    environmentRow,
    await manager.query(
      `SELECT id, slug, name FROM nodrail.environments
       WHERE workspace_id = $1 ORDER BY created_at, slug`,
      [workspaceId],
    ),
  );
  const can = (scope: keyof typeof scopeCapability) =>
    context.capabilities.has(scopeCapability[scope]);
  return {
    token: {
      id: token.id,
      name: token.name,
      prefix: token.prefix,
      scopes: token.scopes,
      createdAt: token.createdAt.toISOString(),
      expiresAt: token.expiresAt?.toISOString() ?? null,
      lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
    },
    person: { name: workspace.person },
    workspace: { id: workspace.id, name: workspace.name, slug: workspace.slug },
    role: z.enum(roles).parse(context.role),
    can: {
      read: can("read"),
      rulesWrite: can("rules:write"),
    },
    environments: environments.map((environment) => ({
      slug: environment.slug,
      name: environment.name,
      default: environment.id === workspace.default_environment_id,
    })),
  };
}
