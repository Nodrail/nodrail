import type { ReactNode } from "react";
import { Disclosure } from "@/components/app/card";
import type { AdapterKey } from "@/contracts/v1/agents";
import {
  applySnippet,
  claudeCodePluginSnippet,
  claudeCodeSettings,
  codexPluginSnippet,
  connectSnippet,
  customClientSnippet,
  environmentSnippet,
  frameworkSnippet,
  sdkEnvironmentSnippet,
  type ConnectPlace,
} from "../setup-snippets";
import { FormHint } from "@/components/app/note";
import { CodeBlock } from "@/components/app/inert-json";

/** Numbered setup steps under the connection form. */
function Instructions({ children }: { children: ReactNode }) {
  return (
    <div className="mt-4.5 grid gap-2.5 border-t pt-4 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-foreground">
      {children}
    </div>
  );
}

function Snippet({ label, text }: { label: string; text: string }) {
  return (
    <CodeBlock className="max-h-80" aria-label={label}>
      {text}
    </CodeBlock>
  );
}

const hookPath = "node /path/to/nodrail-hook.mjs";

const privacyNote = `File contents are sent only as fingerprints. Shell commands, URLs and
  tool inputs are sent with anything that looks like a secret
  removed. That filter is best effort, so avoid putting secrets in them.`;

export function SetupInstructions({
  adapterKey,
  serverUrl,
  place,
}: {
  adapterKey: AdapterKey;
  serverUrl: string;
  /** This workspace and environment, for the project's `connect:` block. */
  place: ConnectPlace;
}) {
  if (adapterKey === "custom-sdk")
    return (
      <Instructions>
        <h3>1. Give your app the credential</h3>
        <Snippet
          label="SDK environment"
          text={sdkEnvironmentSnippet(serverUrl)}
        />
        <h3>2. Wrap your tools</h3>
        <Snippet label="Framework example" text={frameworkSnippet} />
        <FormHint>
          A tool runs only when Nodrail allows it. A timeout, an error or an
          unknown answer all block it, and the agent reads why.
        </FormHint>
        <Disclosure summary="Not using a framework?">
          <Snippet label="Client example" text={customClientSnippet} />
        </Disclosure>
      </Instructions>
    );
  if (adapterKey === "codex-hook")
    return (
      <Instructions>
        <h3>Install the Codex plugin</h3>
        <Snippet label="Codex setup" text={codexPluginSnippet(serverUrl)} />
        <FormHint>
          <code>nodrail apply</code> connects Claude Code to this control plane
          today. For Codex, install the plugin. Codex asks you to trust new
          hooks once, and they do nothing until you do.
        </FormHint>
        <Disclosure summary="What this does and does not cover">
          Shell commands, file patches and MCP tools are checked before they
          run. Web search runs on OpenAI&apos;s side, so Codex can&apos;t check
          it. Codex runs a tool anyway if the hook can&apos;t start at all, for
          example without Node.js. {privacyNote}
        </Disclosure>
      </Instructions>
    );
  return <ClaudeCodeInstructions serverUrl={serverUrl} place={place} />;
}

/** Claude Code: nodrail.yaml and `nodrail apply` first, the plugin second. */
function ClaudeCodeInstructions({
  serverUrl,
  place,
}: {
  serverUrl: string;
  place: ConnectPlace;
}) {
  return (
    <Instructions>
      <h3>1. Declare the connection in nodrail.yaml</h3>
      <Snippet label="nodrail.yaml" text={connectSnippet(serverUrl, place)} />
      <h3>2. Plan and apply</h3>
      <Snippet label="Plan and apply" text={applySnippet(serverUrl)} />
      <FormHint>
        <code>nodrail plan</code> shows what would change and starts nothing.{" "}
        <code>nodrail apply</code> publishes the locked policy here and installs
        the hook in Claude Code. Set the credential wherever Claude Code runs.
      </FormHint>
      <Disclosure summary="No nodrail.yaml yet? Install the plugin">
        <Snippet label="Claude Code setup" text={claudeCodePluginSnippet} />
        <FormHint>
          Claude Code asks for the credential when you install, and keeps it in
          your system&apos;s secure store. The plugin follows the rules
          published in this environment.
        </FormHint>
      </Disclosure>
      <Disclosure summary="Set the hook up by hand">
        <Snippet label="Environment" text={environmentSnippet(serverUrl)} />
        <Snippet
          label="Claude Code settings"
          text={JSON.stringify(claudeCodeSettings(hookPath), null, 2)}
        />
        <FormHint>
          Keep <code>&quot;onFailure&quot;: &quot;block&quot;</code>: without
          it, a hook that crashes or times out lets the tool run.
        </FormHint>
      </Disclosure>
      <Disclosure summary="What this does and does not cover">
        Every tool except those that only read is checked before it runs. A
        Nodrail allow never widens what Claude Code itself permits. Someone who
        can edit these settings, or a process outside Claude Code, can go around
        the hook. {privacyNote}
      </Disclosure>
    </Instructions>
  );
}
