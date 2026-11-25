"use client";

import { Card } from "@/components/app/card";
import { ItemList, ItemRow, ItemText } from "@/components/app/item-list";
import { ActionForm } from "@/components/app/action-form";
import { FormError } from "@/components/app/form-feedback";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { SelectField } from "@/components/app/form-field";
import { useAppAction } from "@/components/app/use-app-action";
import { Button } from "@/components/ui/button";
import type { AgentPeopleDto } from "@/contracts/v1/team";
import { roleLabels } from "@/features/shell/navigation";
import {
  assignAgentAction,
  unassignAgentAction,
} from "@/features/team/actions";
import { FormHint } from "@/components/app/note";

export function AgentPeople({
  workspace,
  agentKey,
  people,
}: {
  workspace: string;
  agentKey: string;
  people: AgentPeopleDto;
}) {
  const [state, assign, pending] = useAppAction(
    assignAgentAction.bind(null, workspace, agentKey),
  );
  return (
    <Card
      title="People"
      description="Viewers only see agents assigned to them. Admins and policy managers see every agent."
    >
      {people.assigned.length ? (
        <ItemList>
          {people.assigned.map((person) => (
            <ItemRow key={person.userId}>
              <ItemText title={person.name} meta={roleLabels[person.role]} />
              <ConfirmDialog
                title={`Unassign ${person.name} from ${agentKey}?`}
                triggerLabel="Unassign"
                confirmLabel="Unassign"
                action={unassignAgentAction.bind(
                  null,
                  workspace,
                  agentKey,
                  person.userId,
                )}
              >
                <p>
                  They stop seeing this agent. Anything they allowed for it that
                  has not been collected yet is closed.
                </p>
              </ConfirmDialog>
            </ItemRow>
          ))}
        </ItemList>
      ) : (
        <FormHint>Nobody is assigned to this agent.</FormHint>
      )}
      {people.available.length ? (
        <ActionForm
          action={assign}
          className="mt-3 flex flex-wrap items-end gap-2.5 [&>[data-slot=form-field]]:flex-[1_1_220px]"
        >
          <SelectField id="assign-person" name="userId" label="Add a person">
            {people.available.map((person) => (
              <option key={person.userId} value={person.userId}>
                {person.name} — {roleLabels[person.role]}
              </option>
            ))}
          </SelectField>
          <Button type="submit" variant="outline" disabled={pending}>
            Assign
          </Button>
          <FormError state={state} />
        </ActionForm>
      ) : null}
    </Card>
  );
}
