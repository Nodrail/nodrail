"use server";

import { type ActionResult } from "@/components/app/action-result";
import {
  connectAgentInput,
  type ConnectedAgentDto,
  type IssuedCredentialDto,
} from "@/contracts/v1/agents";
import { runWorkspaceAction } from "@/features/shell/load-view";
import {
  connectAgent,
  pauseAgent,
  resumeAgent,
  revokeCredential,
  rotateCredential,
} from "@/server/modules/agents";

export async function connectAgentAction(
  workspace: string,
  environmentSlug: string,
  _previous: ActionResult<ConnectedAgentDto>,
  formData: FormData,
): Promise<ActionResult<ConnectedAgentDto>> {
  const parsed = connectAgentInput.safeParse({
    agentKey: formData.get("agentKey"),
    description: formData.get("description") ?? "",
    adapterKey: formData.get("adapterKey"),
    environmentSlug,
  });
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    const message =
      field === "agentKey"
        ? "Use up to 58 lowercase letters, numbers, hyphens or underscores, starting with a letter or number."
        : field === "description"
          ? "Enter a description of up to 200 characters."
          : "Choose a supported host and environment.";
    return { status: "error", message };
  }
  if (parsed.data.adapterKey === "codex-hook")
    return {
      status: "error",
      message: "Choose Codex in project setup to enroll this machine.",
    };
  const result = await runWorkspaceAction(
    workspace,
    (context) =>
      connectAgent(context, {
        ...parsed.data,
        description: parsed.data.description ?? "",
      }),
    {
      ALREADY_EXISTS:
        "That agent already has an installation in this environment.",
    },
  );
  return result.status === "ok" ? { status: "ok", data: result.value } : result;
}

export async function pauseAgentAction(
  workspace: string,
  agentKey: string,
  machine: boolean,
): Promise<ActionResult> {
  const result = await runWorkspaceAction(workspace, (context) =>
    pauseAgent(context, agentKey),
  );
  return result.status === "ok"
    ? {
        status: "ok",
        message: machine ? "Machine paused." : "Agent paused.",
      }
    : result;
}

export async function resumeAgentAction(
  workspace: string,
  agentKey: string,
  machine: boolean,
): Promise<ActionResult> {
  const result = await runWorkspaceAction(workspace, (context) =>
    resumeAgent(context, agentKey),
  );
  return result.status === "ok"
    ? { status: "ok", message: machine ? "Machine resumed." : "Agent resumed." }
    : result;
}

export async function rotateCredentialAction(
  workspace: string,
  installationId: string,
): Promise<ActionResult<IssuedCredentialDto>> {
  const result = await runWorkspaceAction(workspace, (context) =>
    rotateCredential(context, installationId),
  );
  return result.status === "ok" ? { status: "ok", data: result.value } : result;
}

export async function revokeCredentialAction(
  workspace: string,
  installationId: string,
): Promise<ActionResult> {
  const result = await runWorkspaceAction(workspace, (context) =>
    revokeCredential(context, installationId),
  );
  return result.status === "ok"
    ? {
        status: "ok",
        message: "Credential revoked.",
      }
    : result;
}
