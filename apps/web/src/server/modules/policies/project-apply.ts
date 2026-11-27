import "server-only";
import { managedOf, type ProjectApply } from "@/contracts/v1/project-apply";
import { AppError, type WorkspaceContext } from "@/server/db/context";
import { authorizeProject } from "@/server/modules/agents/project-access";
import { takeoverHosts } from "./project-owner";
import { enrollMachine } from "@/server/modules/agents/enrollment";
import { upsertProjectAgents } from "@/server/modules/agents/project-agents";
import {
  getIntendedRevision,
  publishIntendedRevision,
} from "@/server/modules/inventory/revisions";
import { readLiveVersion, type VersionOrigin } from "./managed";
import {
  pinProjectBindings,
  validateProjectBindings,
} from "./project-bindings";
import { projectPinsCurrent } from "./project-pin-status";
import { publishIfChanged } from "./publish";
import { rememberPolicyLock } from "./policy-workspace-lock";
import { fileDigest } from "./policy-file-digest";
import { lockEnvironment } from "./environment-lock";
import { plan } from "./rule-files";

/** Compare, reconcile agents, publish both revisions and enroll in one commit. */
export async function applyProject(
  context: WorkspaceContext,
  environment: string,
  input: ProjectApply,
) {
  const managed = managedOf(input.intended);
  const agentKeys = input.declarations.agents
    .map(({ key }) => key)
    .sort((a, b) => a.localeCompare(b));
  const origin = { managed, source: input.yaml, agentKeys };
  const environmentId = await lockEnvironment(context, environment);
  await authorizeProject(context, managed.project_id, {
    claim: !!input.machine,
  });
  const live = await readLiveVersion(context, environment);
  if (live.policy_revision !== input.policy_revision)
    throw new AppError(
      "RULE_CHANGED",
      "The live policy changed. Run nodrail plan again.",
    );
  const takeover = await takeoverHosts(
    context,
    environmentId,
    managed.project_id,
  );
  if (takeover && !input.replace_live)
    throw new AppError(
      "RULE_CHANGED",
      `Project ${takeover.projectId} owns this environment's live policy. Review the affected enrolled hosts in nodrail plan and use --replace-live to take over.`,
    );
  const current =
    live.managed?.project_id === managed.project_id &&
    live.managed.revision === managed.revision &&
    live.managed.policy_revision === managed.policy_revision &&
    live.source_digest === managed.policy_revision;

  await validateProjectBindings(
    context,
    { id: environmentId, slug: environment },
    input,
  );
  const published = await reconcile(
    context,
    { id: environmentId, live, current, takeover },
    input,
    origin,
  );
  const projectId = managed.project_id;
  await applyIntendedRevision(context, environment, environmentId, input);
  const enrollment = input.machine
    ? await enrollMachine(
        context,
        { environmentId, projectId },
        input.machine,
        agentKeys,
      )
    : null;
  return { published, enrollment };
}

async function applyIntendedRevision(
  context: WorkspaceContext,
  environment: string,
  environmentId: string,
  { intended: input }: ProjectApply,
) {
  const intended = await getIntendedRevision(
    context,
    environment,
    input.project_id,
  );
  if (
    intended?.revision !== input.revision ||
    intended.policyRevision !== input.policy_revision ||
    (input.entry_agent !== undefined &&
      intended.entryAgent !== input.entry_agent)
  )
    await publishIntendedRevision(context, environment, input);
  else if (!(await projectPinsCurrent(context, environmentId, input)))
    await pinProjectBindings(context, environmentId, input);
  if (!(await projectPinsCurrent(context, environmentId, input)))
    throw new AppError(
      "RULE_CHANGED",
      "The workspace bindings changed. Run nodrail plan again.",
    );
}

async function reconcile(
  context: WorkspaceContext,
  {
    id: environmentId,
    live,
    current,
    takeover,
  }: {
    id: string;
    live: Awaited<ReturnType<typeof readLiveVersion>>;
    current: boolean;
    takeover: Awaited<ReturnType<typeof takeoverHosts>>;
  },
  input: ProjectApply,
  origin: VersionOrigin,
) {
  if (
    (!current || input.intended.contracts || input.intended.evidence) &&
    input.file_digest !==
      fileDigest(environmentId, input.yaml, { ...input, takeover })
  )
    throw new AppError(
      "RULE_CHANGED",
      "Preview these project changes before applying.",
    );
  if (current && live.managed_agent_keys) {
    await upsertProjectAgents(context, input.declarations);
    if (
      JSON.stringify(origin.agentKeys) !==
      JSON.stringify(live.managed_agent_keys)
    )
      throw new AppError(
        "RULE_CHANGED",
        "The declared agents differ from the published lock.",
      );
    return null;
  }

  await upsertProjectAgents(context, input.declarations);
  const planned = await plan(
    context,
    environmentId,
    input.yaml,
    input.declarations,
  );
  if (!input.replace_live && !live.managed && planned.removed.length)
    throw new AppError(
      "RULE_CHANGED",
      "Review the rules this lock removes and use --replace-live to replace the live policy.",
    );
  if (planned.issues.length)
    throw new AppError(
      "INVALID_INPUT",
      planned.issues
        .map(({ message, line }) =>
          line ? `${message} (line ${line})` : message,
        )
        .join("\n"),
    );
  const published = await publishIfChanged(
    context,
    environmentId,
    planned,
    origin,
  );
  if (!published)
    await rememberPolicyLock(context, environmentId, input.intended.revision);
  return published;
}
