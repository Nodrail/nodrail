import type { ReactNode } from "react";
import { Disclosure } from "@/components/app/card";
import type { AdapterKey } from "@/contracts/v1/agents";
import {
  claudeCodePluginSnippet,
  claudeCodeSettings,
  customClientSnippet,
  environmentSnippet,
  frameworkSnippet,
  sdkEnvironmentSnippet,
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

const hookPath = "nodrail-claude-hook";

const privacyNote = `File contents are sent only as fingerprints. Shell commands, URLs and
  tool inputs are sent with anything that looks like a secret
  removed. That filter is best effort, so avoid putting secrets in them.`;

export function SetupInstructions({
  adapterKey,
  serverUrl,
}: {
  adapterKey: AdapterKey;
  serverUrl: string;
}) {
  if (adapterKey === "custom-sdk")
    return (
      <Instructions>
        <h3>1. Install the SDK and set its environment</h3>
        <Snippet label="Install the SDK" text="npm install @nodrail/client" />
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
      <FormHint>
        Choose Codex in the project setup and run <code>nodrail apply</code> to
        enroll this machine at <code>{serverUrl}</code>.
      </FormHint>
    );
  return <ClaudeCodeInstructions serverUrl={serverUrl} />;
}

function ClaudeCodeInstructions({ serverUrl }: { serverUrl: string }) {
  return (
    <Instructions>
      <Disclosure summary="Install the Claude Code plugin">
        <Snippet label="Claude Code setup" text={claudeCodePluginSnippet} />
        <FormHint>
          Use Claude Code 2.1.295 or later and put Node.js 22 or later on your
          PATH. In the plugin prompt, enter the credential and set the server
          address to <code>{serverUrl}</code>. Claude Code stores the credential
          in your system&apos;s secure store.
        </FormHint>
      </Disclosure>
      <Disclosure summary="Set the hook up by hand">
        <Snippet
          label="Install the Claude Code hook"
          text="npm install -g @nodrail/client"
        />
        <FormHint>
          Use Node.js 22 or later. Put <code>nodrail-claude-hook</code> on your
          PATH, set these variables in the shell where you launch Claude Code,
          and merge the hook into your project&apos;s{" "}
          <code>.claude/settings.local.json</code>. Use either the plugin or
          this hook entry to avoid checking each call twice.
        </FormHint>
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
