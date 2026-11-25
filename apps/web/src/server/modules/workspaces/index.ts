import "server-only";
import { deploymentMode } from "@/server/deployment";
import { randomBytes, randomUUID } from "node:crypto";
import {
  capabilitiesFor,
  type Capability,
  type Role,
} from "@/contracts/v1/access";
import {
  createWorkspaceInput,
  type EnvironmentDto,
  type WorkspaceSummaryDto,
  type WorkspaceViewDto,
} from "@/contracts/v1/workspaces";
import {
  notificationPreferencesInput,
  workspaceSettingsInput,
  type NotificationPreferencesDto,
} from "@/contracts/v1/team";
import { isReservedWorkspaceSlug } from "@nodrail/web-shared/routes";
import { AuditEvent, Workspace } from "@/server/db/entities";
import { provisionWorkspace } from "@/server/db/provisioning";
import { recordAudit } from "@/server/modules/audit";
import {
  AppError,
  inNewWorkspace,
  parseInput,
  readWorkspace,
  requireCapability,
  withUser,
  type HumanPrincipal,
  type WorkspaceContext,
} from "@/server/db/context";

function baseSlug(name: string) {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/, "");
  return slug || "workspace";
}

/**
 * Slugs are global but other workspaces are invisible, so the only way to learn
 * one is taken is to try it. Every attempt is its own transaction. A name whose
 * slug is reserved for a route ("Billing", "Docs") gets a suffix straight away,
 * as if the slug were taken: the slug is derived, so there is nothing to fix.
 */
export async function createWorkspace(
  principal: HumanPrincipal,
  rawInput: unknown,
): Promise<{ slug: string; workspaceId: string }> {
  const { name } = parseInput(createWorkspaceInput, rawInput);
  const base = baseSlug(name);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const slug =
      attempt === 0 && !isReservedWorkspaceSlug(base)
        ? base
        : `${base}-${randomBytes(3).toString("hex")}`;
    const workspaceId = randomUUID();
    try {
      await inNewWorkspace(principal, workspaceId, async ({ manager }) => {
        await provisionWorkspace(manager, {
          id: workspaceId,
          name,
          slug,
          ownerUserId: principal.userId,
        });
        await manager.insert(AuditEvent, {
          workspaceId,
          eventType: "workspace.created",
          actorKind: "human",
          actorUserId: principal.userId,
          decisionCode: "workspace_created",
        });
      });
      return { slug, workspaceId };
    } catch (error) {
      if (!(error instanceof AppError && error.code === "ALREADY_EXISTS"))
        throw error;
    }
  }
  throw new AppError("BUSY");
}

/** Every environment-scoped use case starts here. Unknown means not found. */
export async function findEnvironment(
  context: WorkspaceContext,
  slug: string,
): Promise<EnvironmentDto> {
  const [environment]: EnvironmentDto[] = await context.manager.query(
    `SELECT id, slug, name FROM nodrail.environments
     WHERE workspace_id = $1 AND slug = $2`,
    [context.workspaceId, slug],
  );
  if (!environment) throw new AppError("NOT_FOUND");
  return environment;
}

export function listMyWorkspaces(
  principal: HumanPrincipal,
): Promise<WorkspaceSummaryDto[]> {
  return withUser(principal, async ({ manager }) => {
    const rows: { id: string; name: string; slug: string; role: Role }[] =
      await manager.query(
        `SELECT w.id, w.name, w.slug, m.role
         FROM nodrail.workspace_memberships m
         JOIN nodrail.workspaces w ON w.id = m.workspace_id
         WHERE m.user_id = $1 AND m.status = 'active' AND w.archived_at IS NULL
         ORDER BY w.name, w.id
         LIMIT 100`,
        [principal.userId],
      );
    return rows;
  });
}

/** A session selects a workspace by slug without loading other memberships. */
export function findMyWorkspaceId(principal: HumanPrincipal, slug: string) {
  return withUser(principal, async ({ manager }) => {
    const [workspace]: { id: string }[] = await manager.query(
      `SELECT w.id FROM nodrail.workspace_memberships m
       JOIN nodrail.workspaces w ON w.id = m.workspace_id
       WHERE m.user_id = $1 AND w.slug = $2
         AND m.status = 'active' AND w.archived_at IS NULL`,
      [principal.userId, slug],
    );
    if (!workspace) throw new AppError("NOT_FOUND");
    return workspace.id;
  });
}

export async function listEnvironments(context: WorkspaceContext) {
  const environments: EnvironmentDto[] = await context.manager.query(
    `SELECT id, slug, name FROM nodrail.environments
     WHERE workspace_id = $1 ORDER BY slug`,
    [context.workspaceId],
  );
  return environments;
}

export async function getWorkspaceSettings(context: WorkspaceContext) {
  const [workspace]: {
    id: string;
    name: string;
    slug: string;
    default_environment_id: string | null;
  }[] = await context.manager.query(
    `SELECT id, name, slug, default_environment_id
     FROM nodrail.workspaces WHERE id = $1`,
    [context.workspaceId],
  );
  if (!workspace) throw new AppError("NOT_FOUND");
  return {
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    defaultEnvironmentId: workspace.default_environment_id,
  };
}

/** Everything the app shell needs. Not found looks the same as not a member. */
export async function getWorkspaceView(
  principal: HumanPrincipal,
  slug: string,
): Promise<WorkspaceViewDto> {
  const workspaces = await listMyWorkspaces(principal);
  const summary = workspaces.find((workspace) => workspace.slug === slug);
  if (!summary) throw new AppError("NOT_FOUND");

  return readWorkspace(principal, summary.id, async (context) => {
    const environments = await listEnvironments(context);
    const [person]: { display_name: string; verified_email: string | null }[] =
      await context.manager.query(
        `SELECT display_name, verified_email FROM nodrail.users WHERE id = $1`,
        [principal.userId],
      );
    const workspace = await getWorkspaceSettings(context);
    const capabilities: Capability[] = capabilitiesFor(
      context.role,
      context.isOwner,
    );
    return {
      ...workspace,
      role: context.role,
      isOwner: context.isOwner,
      capabilities,
      environments,
      otherWorkspaces: workspaces.filter((item) => item.id !== summary.id),
      person: {
        id: principal.userId,
        name: person?.display_name ?? "",
        email: person?.verified_email ?? null,
      },
    };
  });
}

/** Renaming keeps the slug, so links people already have keep working. */
export async function updateWorkspaceSettings(
  context: WorkspaceContext,
  rawInput: unknown,
): Promise<void> {
  requireCapability(context, "workspace:settings");
  const { name, defaultEnvironment } = parseInput(
    workspaceSettingsInput,
    rawInput,
  );
  const environment = await findEnvironment(context, defaultEnvironment).catch(
    (error: unknown) => {
      throw error instanceof AppError && error.code === "NOT_FOUND"
        ? new AppError("INVALID_INPUT")
        : error;
    },
  );
  await context.manager.update(
    Workspace,
    { id: context.workspaceId },
    { name, defaultEnvironmentId: environment.id },
  );
  await recordAudit(context, {
    eventType: "workspace.updated",
    decisionCode: "workspace_updated",
    payload: { subject: name, detail: environment.name },
  });
}

/** Everything is on until a person chooses otherwise. */
export async function getNotificationPreferences(
  context: WorkspaceContext,
): Promise<NotificationPreferencesDto> {
  const [row]: {
    integration_stale: boolean;
    usage_alerts: boolean;
  }[] = await context.manager.query(
    `SELECT integration_stale, usage_alerts
     FROM nodrail.notification_preferences
     WHERE workspace_id = $1 AND user_id = $2`,
    [context.workspaceId, context.principal.userId],
  );
  return {
    integrationStale: row?.integration_stale ?? true,
    usageAlerts: row?.usage_alerts ?? true,
  };
}

/** Each person's own choice, so no capability is involved. */
export async function saveNotificationPreferences(
  context: WorkspaceContext,
  rawInput: unknown,
): Promise<void> {
  const input = parseInput(notificationPreferencesInput, rawInput);
  await context.manager.query(
    `INSERT INTO nodrail.notification_preferences
       (workspace_id, user_id, integration_stale, usage_alerts)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (workspace_id, user_id) DO UPDATE
     SET integration_stale = EXCLUDED.integration_stale,
         usage_alerts = EXCLUDED.usage_alerts,
         updated_at = now()`,
    [
      context.workspaceId,
      context.principal.userId,
      input.integrationStale,
      input.usageAlerts,
    ],
  );
}

/** Closing a workspace is final for everyone in it, so it is typed out. */
export async function archiveWorkspace(
  context: WorkspaceContext,
  confirmation: unknown,
): Promise<void> {
  requireCapability(context, "ownership:manage");
  const { manager, workspaceId } = context;
  const [row]: { name: string; status: string | null }[] = await manager.query(
    `SELECT w.name, b.status FROM nodrail.workspaces w
     LEFT JOIN nodrail.workspace_billing b ON b.workspace_id = w.id
     WHERE w.id = $1 FOR UPDATE OF w`,
    [workspaceId],
  );
  if (typeof confirmation !== "string" || confirmation.trim() !== row?.name)
    throw new AppError("INVALID_INPUT");
  if (
    deploymentMode() === "cloud" &&
    ["active", "trialing", "past_due", "unpaid"].includes(row.status ?? "")
  )
    throw new AppError("BILLING_ACTIVE");
  await manager.update(
    Workspace,
    { id: workspaceId },
    { archivedAt: new Date() },
  );
  await recordAudit(context, {
    eventType: "workspace.archived",
    decisionCode: "workspace_archived",
  });
}
