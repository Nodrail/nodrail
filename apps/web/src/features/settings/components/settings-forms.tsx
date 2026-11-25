"use client";

import { ActionForm } from "@/components/app/action-form";
import { SaveRow } from "@/components/app/form-feedback";
import { Card } from "@/components/app/card";
import { CheckboxField } from "@/components/app/choice-field";
import { FormField, SelectField } from "@/components/app/form-field";
import { useAppAction } from "@/components/app/use-app-action";
import type { Capability } from "@/contracts/v1/access";
import { receivesNotification } from "@/contracts/v1/notifications";
import type { NotificationPreferencesDto } from "@/contracts/v1/team";
import type { EnvironmentDto } from "@/contracts/v1/workspaces";
import { savePreferencesAction, saveWorkspaceAction } from "../actions";
import { FormHint } from "@/components/app/note";

const settingsForm = "grid gap-3.5";

export function WorkspaceForm({
  workspace,
  name,
  environments,
  defaultEnvironment,
}: {
  workspace: string;
  name: string;
  environments: EnvironmentDto[];
  defaultEnvironment: string;
}) {
  const [state, submit, pending] = useAppAction(
    saveWorkspaceAction.bind(null, workspace),
  );
  return (
    <Card title="Workspace">
      <ActionForm action={submit} className={settingsForm}>
        <FormField
          id="workspace-name"
          name="name"
          label="Workspace name"
          defaultValue={name}
          maxLength={120}
          autoComplete="organization"
          required
          hint="Renaming does not change this workspace's links."
        />
        <SelectField
          id="default-environment"
          name="defaultEnvironment"
          label="Default environment"
          defaultValue={defaultEnvironment}
          hint="Where this workspace opens. Your current page is not affected."
        >
          {environments.map((environment) => (
            <option key={environment.slug} value={environment.slug}>
              {environment.name}
            </option>
          ))}
        </SelectField>
        <SaveRow state={state} pending={pending} />
      </ActionForm>
    </Card>
  );
}

const choices: {
  name: keyof NotificationPreferencesDto;
  title: string;
  detail: string;
}[] = [
  {
    name: "integrationStale",
    title: "Integration stops reporting",
    detail: "A connected integration misses its expected check-in.",
  },
  {
    name: "usageAlerts",
    title: "Plan usage",
    detail:
      "This workspace reaches 80% or all of its monthly actions or run steps.",
  },
];

export function NotificationsForm({
  workspace,
  preferences,
  capabilities,
  showBilling,
}: {
  workspace: string;
  preferences: NotificationPreferencesDto;
  capabilities: Capability[];
  showBilling: boolean;
}) {
  const [state, submit, pending] = useAppAction(
    savePreferencesAction.bind(null, workspace),
  );
  const canChoose = ({ name }: (typeof choices)[number]) =>
    (name !== "usageAlerts" || showBilling) &&
    receivesNotification(name, capabilities);
  const offered = choices.some(canChoose);
  return (
    <Card
      title="Notifications"
      description="Your own choices for this workspace, sent by email."
    >
      <ActionForm action={submit} className={settingsForm}>
        {choices.map((choice) =>
          canChoose(choice) ? (
            <CheckboxField
              key={choice.name}
              name={choice.name}
              defaultChecked={preferences[choice.name]}
              title={choice.title}
              detail={choice.detail}
            />
          ) : preferences[choice.name] ? (
            // Kept for if this person's role changes later.
            <input key={choice.name} type="hidden" name={choice.name} />
          ) : null,
        )}
        {offered ? (
          <SaveRow state={state} pending={pending} />
        ) : (
          <FormHint>Your role doesn&apos;t receive notifications.</FormHint>
        )}
      </ActionForm>
    </Card>
  );
}
