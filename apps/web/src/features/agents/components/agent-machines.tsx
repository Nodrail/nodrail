import { RowActions } from "@/components/app/row-actions";
import { StatusBadge } from "@/components/app/status-badge";
import type { InstallationDto } from "@/contracts/v1/agents";
import { machineConfirm } from "../access-confirm";
import { reportingBadge } from "../presentation";

export function AgentMachines({
  machines,
  workspace,
  canManage,
}: {
  machines: InstallationDto[];
  workspace: string;
  canManage: boolean;
}) {
  return (
    <ul aria-label="Machines" className="ml-6 border-l pl-4">
      {machines.map((machine) => {
        const badge = machine.disconnected
          ? ({ tone: "neutral", label: "Disconnected" } as const)
          : machine.machinePaused
            ? ({ tone: "neutral", label: "Paused" } as const)
            : reportingBadge[machine.reporting];
        return (
          <li
            key={machine.id}
            className="flex items-center gap-2 py-1.5 text-sm"
          >
            <span>{machine.name}</span>
            <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
            {canManage && machine.machineKey && !machine.disconnected ? (
              <RowActions
                name={machine.name}
                items={[
                  {
                    label: machine.machinePaused
                      ? "Resume machine…"
                      : "Pause machine…",
                    destructive: !machine.machinePaused,
                    confirm: machineConfirm(workspace, machine),
                  },
                ]}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
