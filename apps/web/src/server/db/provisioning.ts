import { randomUUID } from "node:crypto";
import type { EntityManager } from "typeorm";
import {
  assertEnvironmentSlug,
  assertWorkspaceSlug,
} from "@nodrail/web-shared/routes";
import {
  ActivePolicy,
  Environment,
  PolicyVersion,
  Workspace,
  WorkspaceMembership,
} from "./entities";

const initialEnvironments = [
  { slug: "development", name: "Development" },
  { slug: "production", name: "Production" },
] as const;

export type ProvisionedEnvironment = {
  environmentId: string;
  versionId: string;
};

/**
 * The one definition of a new workspace: an owner and both environments, each
 * with an empty live policy that allows nothing. Run inside a transaction.
 */
export async function provisionWorkspace(
  manager: EntityManager,
  workspace: { id: string; name: string; slug: string; ownerUserId: string },
) {
  const { id: workspaceId, name, slug, ownerUserId } = workspace;
  // On the app host `/<slug>` must open the workspace, not a route of the app.
  assertWorkspaceSlug(slug);
  await manager.insert(Workspace, { id: workspaceId, name, slug });
  await manager.insert(WorkspaceMembership, {
    workspaceId,
    userId: ownerUserId,
    role: "admin",
    isOwner: true,
  });

  const provision = async (
    environment: (typeof initialEnvironments)[number],
  ): Promise<ProvisionedEnvironment> => {
    // `/<workspace>/<environment>` must not open a page of the workspace.
    assertEnvironmentSlug(environment.slug);
    const environmentId = randomUUID();
    const versionId = randomUUID();
    await manager.insert(Environment, {
      id: environmentId,
      workspaceId,
      ...environment,
    });
    await manager.insert(PolicyVersion, {
      id: versionId,
      workspaceId,
      environmentId,
      revision: 1,
      publishedBy: ownerUserId,
    });
    await manager.insert(ActivePolicy, {
      workspaceId,
      environmentId,
      policyVersionId: versionId,
    });
    return { environmentId, versionId };
  };

  const [development, production] = [
    await provision(initialEnvironments[0]),
    await provision(initialEnvironments[1]),
  ];
  await manager.update(
    Workspace,
    { id: workspaceId },
    { defaultEnvironmentId: development.environmentId },
  );
  return { development, production };
}
