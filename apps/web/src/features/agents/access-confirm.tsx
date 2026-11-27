import Link from "next/link";
import type { ConfirmProps } from "@/components/app/confirm-dialog";
import type { AgentAccessDto, InstallationDto } from "@/contracts/v1/agents";
import { pauseAgentAction, resumeAgentAction } from "./actions";

type Agent = {
  key: string;
  project?: string | null;
  entryAgent?: string | null;
  access: Pick<AgentAccessDto, "status">;
};

export function accessConfirm(
  workspace: string,
  agent: Agent,
  target: { machinesHref: string } | { machine: string },
): ConfirmProps<unknown> {
  const machine = "machine" in target ? target.machine : undefined;
  const scope = machine ? "machine" : "agent";
  const name = machine ?? agent.key;
  if (agent.access.status === "paused")
    return {
      kicker: `Resume ${scope}`,
      title: `Resume ${name}?`,
      confirmLabel: `Resume ${scope}`,
      confirmVariant: "default",
      action: resumeAgentAction.bind(null, workspace, agent.key, !!machine),
      children: (
        <p>
          {machine
            ? "New covered calls on this machine can proceed if the caller and policy allow them."
            : "New covered calls by this agent can proceed wherever the machine and policy allow them."}{" "}
          Requests invalidated by the pause must be submitted again.
        </p>
      ),
    };
  return {
    kicker: `Pause ${scope}`,
    title: `Pause ${name}?`,
    confirmLabel: `Pause ${scope}`,
    action: pauseAgentAction.bind(null, workspace, agent.key, !!machine),
    children: (
      <p>
        {machine
          ? "Blocks new covered calls from every caller on this machine, including unidentified callers."
          : "Stops this agent on machines that report it. To contain a machine you don't trust, pause or revoke the machine."}{" "}
        {!machine && agent.project ? (
          <>
            In Claude Code, the main session runs as{" "}
            {agent.entryAgent ? (
              <code>{agent.entryAgent}</code>
            ) : (
              "the entry agent declared in nodrail.yaml"
            )}
            . Subagents are identified by host metadata. Unidentified subagents
            are blocked while an applicable agent is paused.{" "}
          </>
        ) : null}
        {"machinesHref" in target ? (
          <Link href={target.machinesHref} className="underline">
            Manage machines
          </Link>
        ) : null}{" "}
        Pending requests must be submitted again after resuming. Calls already
        cleared to run and calls outside the integration are unaffected.
      </p>
    ),
  };
}

export function machineConfirm(workspace: string, machine: InstallationDto) {
  return accessConfirm(
    workspace,
    {
      key: machine.machineKey!,
      access: { status: machine.machinePaused ? "paused" : "active" },
    },
    { machine: machine.name },
  );
}
