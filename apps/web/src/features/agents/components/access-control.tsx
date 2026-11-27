"use client";

import { ConfirmDialog } from "@/components/app/confirm-dialog";
import type { AgentDetailDto } from "@/contracts/v1/agents";
import { accessConfirm } from "../access-confirm";

export function AccessControl({
  workspace,
  base,
  agent,
}: {
  workspace: string;
  base: string;
  agent: Pick<
    AgentDetailDto,
    "key" | "access" | "installations" | "project" | "entryAgent"
  >;
}) {
  const machine = agent.installations.find(
    ({ machineKey }) => machineKey === agent.key,
  );
  const paused = agent.access.status === "paused";
  return (
    <ConfirmDialog
      key={paused ? "resume" : "pause"}
      triggerLabel={paused ? "Resume" : "Pause"}
      triggerVariant={paused ? "outline" : "danger-quiet"}
      {...accessConfirm(
        workspace,
        agent,
        machine
          ? { machine: machine.name }
          : { machinesHref: `${base}/agents#machines` },
      )}
    />
  );
}
