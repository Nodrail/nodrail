"use client";

import { ConfirmDialog } from "@/components/app/confirm-dialog";
import type { AgentDetailDto } from "@/contracts/v1/agents";
import { accessConfirm } from "../access-confirm";

export function AccessControl({
  workspace,
  agent,
}: {
  workspace: string;
  agent: Pick<AgentDetailDto, "key" | "access" | "installations">;
}) {
  const paused = agent.access.status === "paused";
  return (
    <ConfirmDialog
      key={paused ? "resume" : "pause"}
      triggerLabel={paused ? "Resume" : "Pause"}
      triggerVariant={paused ? "outline" : "danger-quiet"}
      {...accessConfirm(workspace, agent)}
    />
  );
}
