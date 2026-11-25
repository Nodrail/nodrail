import type { ConfirmProps } from "@/components/app/confirm-dialog";
import type { AgentAccessDto, InstallationDto } from "@/contracts/v1/agents";
import { pauseAgentAction, resumeAgentAction } from "./actions";

type Agent = {
  key: string;
  access: Pick<AgentAccessDto, "status">;
  installations: Pick<InstallationDto, "id" | "name" | "environment">[];
};

/**
 * The confirmation before pausing an agent, or resuming a paused one, from
 * its page or its row in the list. Plain data and a bound server action, so a
 * server component can hand it to a client menu.
 */
export function accessConfirm(
  workspace: string,
  agent: Agent,
): ConfirmProps<unknown> {
  if (agent.access.status === "paused")
    return {
      kicker: "Resume agent",
      title: `Resume ${agent.key}?`,
      confirmLabel: "Resume agent",
      confirmVariant: "default",
      action: resumeAgentAction.bind(null, workspace, agent.key),
      children: (
        <p>
          New covered checks will be evaluated again. Requests closed by the
          pause stay closed, so the agent has to ask again.
        </p>
      ),
    };
  return {
    kicker: "Pause agent",
    title: `Pause ${agent.key}?`,
    confirmLabel: "Pause agent",
    action: pauseAgentAction.bind(null, workspace, agent.key),
    children: (
      <>
        <p>
          New covered checks for this agent will be blocked when the integration
          checks them. Its open requests will be closed. This does not stop
          direct calls outside the configured integration or undo completed
          actions.
        </p>
        <p className="font-semibold">Applies to:</p>
        <ul>
          {agent.installations.map((installation) => (
            <li key={installation.id}>
              {installation.name} · {installation.environment.name}
            </li>
          ))}
        </ul>
      </>
    ),
  };
}
