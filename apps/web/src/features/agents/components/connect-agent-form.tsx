"use client";

import type { ReactNode } from "react";
import { ActionForm } from "@/components/app/action-form";
import { Card } from "@/components/app/card";
import { ChoiceRow } from "@/components/app/choice-field";
import { FormFooter, SubmitButton } from "@/components/app/form-feedback";
import { FormField } from "@/components/app/form-field";
import { Note } from "@/components/app/note";
import { useAppAction } from "@/components/app/use-app-action";
import { adapters, type ConnectedAgentDto } from "@/contracts/v1/agents";
import { connectAgentAction } from "../actions";
import { ConnectSuccess, CoverageLimits } from "./connect-success";

/** The runtimes an agent can connect through; the first is preselected. */
function AdapterOptions() {
  return (
    <fieldset className="stagger grid gap-1.75">
      <legend className="sr-only">Runtime</legend>
      {adapters
        .filter(({ key }) => key !== "codex-hook")
        .map((adapter, index) => (
          <ChoiceRow
            key={adapter.key}
            name="adapterKey"
            value={adapter.key}
            defaultChecked={index === 0}
            title={adapter.label}
            detail={adapter.detail}
          />
        ))}
    </fieldset>
  );
}

/** One numbered step of connecting, as an item of the steps' list. */
function Step({
  number,
  title,
  description,
  tour,
  children,
}: {
  number: number;
  title: string;
  description?: string;
  tour: string;
  children: ReactNode;
}) {
  return (
    <li data-slot="connect-step" className="min-w-0">
      <Card tour={tour} title={`${number}. ${title}`} description={description}>
        {children}
      </Card>
    </li>
  );
}

/** Step 2's fields: the agent's ID and what it does. */
function IdentityFields({ initialKey }: { initialKey: string }) {
  return (
    <>
      <div className="grid gap-3.5">
        <FormField
          id="agentKey"
          name="agentKey"
          label="Agent ID"
          defaultValue={initialKey}
          placeholder="support-agent"
          autoComplete="off"
          maxLength={58}
          required
        />
        <FormField
          id="description"
          name="description"
          label="Description"
          optional
          placeholder="What does this agent do?"
          autoComplete="off"
          maxLength={200}
        />
      </div>
      <Note>
        <b>Unknown actions stay blocked.</b> The hook denies uncovered calls and
        returns the reason.
      </Note>
    </>
  );
}

/**
 * Standalone setup collects the host and agent ID, then shows the credential
 * and installation instructions. The first check-in updates the status.
 */
export function ConnectAgentForm({
  workspace,
  environmentSlug,
  environmentName,
  agentsPath,
  serverUrl,
  initialKey,
}: {
  workspace: string;
  environmentSlug: string;
  environmentName: string;
  agentsPath: string;
  serverUrl: string;
  initialKey: string;
}) {
  const [state, action, pending] = useAppAction<ConnectedAgentDto>(
    connectAgentAction.bind(null, workspace, environmentSlug),
  );

  if (state.status === "ok" && state.data)
    return (
      <ConnectSuccess
        connected={state.data}
        environmentName={environmentName}
        agentsPath={agentsPath}
        serverUrl={serverUrl}
      />
    );

  return (
    <ActionForm action={action} className="grid max-w-3xl min-w-0 gap-3">
      <ol className="grid gap-3">
        <Step
          number={1}
          tour="standalone-runtime"
          title="Choose its host"
          description="Where your agent runs. The setup steps are written for it."
        >
          <AdapterOptions />
        </Step>
        <Step
          number={2}
          tour="standalone-identity"
          title="Name it"
          description="Use the same ID in the agent's configuration. Its rules and activity are listed under it."
        >
          <IdentityFields initialKey={initialKey} />
        </Step>
        <Step
          number={3}
          tour="standalone-submit"
          title="Create a standalone credential"
          description="You get a credential, shown once, and the steps to set up the host. Then the checks to run, ticked as they show."
        >
          <FormFooter state={state}>
            <SubmitButton size="lg" pending={pending} pendingLabel="Creating…">
              Create credential
            </SubmitButton>
          </FormFooter>
        </Step>
      </ol>
      <CoverageLimits />
    </ActionForm>
  );
}
