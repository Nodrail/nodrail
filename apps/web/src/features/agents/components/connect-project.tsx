"use client";

import { useState } from "react";
import { Card, Disclosure } from "@/components/app/card";
import { ChoiceRow } from "@/components/app/choice-field";
import { Button } from "@/components/ui/button";
import { useCopy } from "@/components/app/use-copy";
import { CodeBlock } from "@/components/app/inert-json";
import {
  applySnippet,
  connectSnippet,
  connectCommand,
  projectRuntimes,
  type ConnectPlace,
  type ProjectRuntime,
} from "../setup-snippets";
import { ProjectCheckIn } from "./project-check-in";
import { ConnectAgentForm } from "./connect-agent-form";

export function ConnectProject({
  place,
  environmentName,
  agentsPath,
  activityPath,
  checkInMarker,
  serverUrl,
  initialKey,
  projectId,
  canCreateStandalone,
}: {
  place: ConnectPlace;
  environmentName: string;
  agentsPath: string;
  activityPath: string;
  checkInMarker: string;
  serverUrl: string;
  initialKey: string;
  projectId: string;
  canCreateStandalone: boolean;
}) {
  const [runtime, setRuntime] = useState<ProjectRuntime>("claude-code");
  return (
    <div className="grid max-w-3xl min-w-0 gap-3">
      <Card title="Choose your host" tour="connect-runtime">
        <fieldset className="grid gap-1.75">
          <legend className="sr-only">Project host</legend>
          {projectRuntimes.map(({ key, label }) => (
            <ChoiceRow
              key={key}
              name="runtime"
              value={key}
              checked={runtime === key}
              onChange={() => setRuntime(key)}
              title={label}
            />
          ))}
        </fieldset>
      </Card>
      <ProjectInstall />
      <ProjectSteps
        {...{
          place,
          environmentName,
          activityPath,
          checkInMarker,
          serverUrl,
          projectId,
          runtime,
        }}
      />
      {canCreateStandalone ? (
        <details
          className="rounded-lg border bg-card p-4"
          open={initialKey ? true : undefined}
        >
          <summary className="cursor-pointer text-ui font-semibold">
            Standalone plugin, manual hook or SDK
          </summary>
          <p className="my-3 text-ui">
            For integrations outside <code>nodrail.yaml</code>, create a
            standalone credential. For Codex, choose Codex above and enroll the
            machine through your project.
          </p>
          <ConnectAgentForm
            workspace={place.workspace}
            environmentSlug={place.environment}
            environmentName={environmentName}
            agentsPath={agentsPath}
            serverUrl={serverUrl}
            initialKey={initialKey}
          />
        </details>
      ) : null}
    </div>
  );
}

function ProjectInstall() {
  return (
    <Card title="Install or update the CLI" tour="connect-login">
      <p className="mb-2 text-ui">Use Node.js 22 or later.</p>
      <CodeBlock aria-label="Install the CLI">npm i -g @nodrail/cli</CodeBlock>
      <p className="mt-2 text-ui">
        With pnpm, use <code>pnpm add -g @nodrail/cli</code>.
      </p>
    </Card>
  );
}

function ProjectManifest({
  runtime,
  projectId,
  serverUrl,
  place,
}: {
  runtime: ProjectRuntime;
  projectId: string;
  serverUrl: string;
  place: ConnectPlace;
}) {
  const copy = useCopy();
  const command = connectCommand(serverUrl, place, runtime);
  return (
    <Card title="Connect this project" tour="connect-identity">
      <p className="mb-2 text-ui">
        Run this in your project folder. It updates <code>nodrail.yaml</code>,
        opens your browser if you need to sign in, locks the configuration and
        shows what apply will change.
      </p>
      <CodeBlock aria-label="Connect command">{command}</CodeBlock>
      <Button
        type="button"
        variant="outline"
        className="mt-2"
        onClick={() => void copy(command)}
      >
        Copy connect command
      </Button>
      <Disclosure summary="Edit nodrail.yaml by hand">
        <p className="mb-2">
          Keep your project ID. If it has none, add <code>id: {projectId}</code>{" "}
          at the top level.
        </p>
        <CodeBlock aria-label="nodrail.yaml">
          {connectSnippet(serverUrl, place)}
        </CodeBlock>
        <CodeBlock aria-label="Sign in, lock and plan">
          {`nodrail login --url ${serverUrl}
nodrail policy lock
nodrail plan --runtime ${runtime}`}
        </CodeBlock>
      </Disclosure>
    </Card>
  );
}

function ExampleProject({ command }: { command: string }) {
  const copy = useCopy();
  const steps = `nodrail example support-desk ./desk && cd desk\n${command}`;
  return (
    <Card title="Start with an example project">
      <p className="mb-2 text-ui">
        Use these commands if you need a project to try.
      </p>
      <CodeBlock aria-label="Create and connect the example project">
        {steps}
      </CodeBlock>
      <Button
        type="button"
        variant="outline"
        className="mt-2"
        onClick={() => void copy(steps)}
      >
        Copy example setup
      </Button>
    </Card>
  );
}

function ProjectSteps({
  place,
  environmentName,
  activityPath,
  checkInMarker,
  serverUrl,
  projectId,
  runtime,
}: {
  place: ConnectPlace;
  environmentName: string;
  activityPath: string;
  checkInMarker: string;
  serverUrl: string;
  projectId: string;
  runtime: ProjectRuntime;
}) {
  const host = projectRuntimes.find((option) => option.key === runtime)!;
  return (
    <>
      <ExampleProject command={connectCommand(serverUrl, place, runtime)} />
      <ProjectManifest {...{ runtime, projectId, serverUrl, place }} />
      <Card title="Apply the reviewed plan" tour="connect-submit">
        <p className="mb-2 text-ui">
          Run these in the project folder. Apply registers the agents declared
          in your project, publishes the locked policy, enrolls this machine,
          and sends its first setup report to Inventory. Session starts refresh
          the report.
        </p>
        <p className="mb-2 text-ui">
          For a starter policy, add the Read-only pack to your repository with{" "}
          <code>nodrail add @nodrail/read-only</code> before connecting.
        </p>
        <CodeBlock aria-label="Apply command">
          {applySnippet(runtime)}
        </CodeBlock>
        {runtime === "codex" ? (
          <p className="mt-2 text-ui">
            Open Codex in this folder, trust the folder, then run{" "}
            <code>/hooks</code> and trust the Nodrail hook.
          </p>
        ) : null}
        {runtime === "copilot" ? (
          <p className="mt-2 text-ui">
            Open <code>copilot</code> in this folder and choose to remember it
            so Copilot runs project hooks.
          </p>
        ) : null}
      </Card>
      <ProjectCheckIn
        activityPath={activityPath}
        environmentName={environmentName}
        host={host.command}
        marker={checkInMarker}
        runtime={runtime}
      />
    </>
  );
}
