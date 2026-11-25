"use server";

import { type ActionResult } from "@/components/app/action-result";
import type {
  ConnectedAgentDto,
  IssuedCredentialDto,
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
  const result = await runWorkspaceAction(
    workspace,
    (context) =>
      connectAgent(context, {
        agentKey: formData.get("agentKey"),
        description: formData.get("description") ?? "",
        adapterKey: formData.get("adapterKey"),
        environmentSlug,
      }),
    {
      INVALID_INPUT:
        "Use lowercase letters, numbers, hyphens or underscores, starting with a letter or number.",
      ALREADY_EXISTS: "That agent is already connected in this environment.",
    },
  );
  return result.status === "ok" ? { status: "ok", data: result.value } : result;
}

export async function pauseAgentAction(
  workspace: string,
  agentKey: string,
): Promise<ActionResult> {
  const result = await runWorkspaceAction(workspace, (context) =>
    pauseAgent(context, agentKey),
  );
  return result.status === "ok"
    ? {
        status: "ok",
        message: "Agent paused.",
      }
    : result;
}

export async function resumeAgentAction(
  workspace: string,
  agentKey: string,
): Promise<ActionResult> {
  const result = await runWorkspaceAction(workspace, (context) =>
    resumeAgent(context, agentKey),
  );
  return result.status === "ok"
    ? { status: "ok", message: "Agent resumed." }
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
