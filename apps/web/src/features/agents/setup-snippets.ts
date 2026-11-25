import { claudeCodeHooks, governedTools } from "@nodrail/client/setup";

export { governedTools };

export const claudeCodeSettings = (hookCommand: string) => ({
  hooks: claudeCodeHooks({ command: hookCommand }),
});

/** Where the plugins are published from. */
const PLUGINS = "Nodrail/agent-plugins";

export const claudeCodePluginSnippet = `/plugin marketplace add ${PLUGINS}
/plugin install nodrail@nodrail`;

export const codexPluginSnippet = (serverUrl: string) =>
  `codex plugin marketplace add ${PLUGINS}
codex plugin add nodrail@nodrail

# Save the credential once, for every Codex session on this machine.
# Paste it, press Enter, then Ctrl-D. It stays out of your shell history.
mkdir -p ~/.nodrail && (umask 077; cat > ~/.nodrail/credential)
${serverUrl === "https://app.nodrail.com" ? "" : `export NODRAIL_URL="${serverUrl}"\n`}
# Then start Codex and trust the Nodrail hooks in /hooks.`;

export const environmentSnippet = (serverUrl: string) =>
  `export NODRAIL_URL="${serverUrl}"\nexport NODRAIL_CREDENTIAL="<the credential above>"`;

export const sdkEnvironmentSnippet = (serverUrl: string) =>
  `${serverUrl === "https://app.nodrail.com" ? "" : `NODRAIL_URL="${serverUrl}"\n`}NODRAIL_CREDENTIAL="<the credential above>"`;

export const frameworkSnippet = `import { guard } from "@nodrail/client";

// In your existing agent, wrap the tools you already pass. Nothing else changes.
// Before: generateText({ model, tools, prompt })
const result = await generateText({ model, tools: guard(tools), prompt });

// LangChain, OpenAI Agents, Mastra, LlamaIndex: the same, wherever you pass tools.
const agent = createAgent({ model, tools: guard(tools) });`;

export const customClientSnippet = `import { createNodrail } from "@nodrail/client";

const nodrail = createNodrail();

// Runs only if allowed. Anything else throws, and nothing runs.
await nodrail.run(
  {
    tool: "github",
    operation: "issues.create",
    resource: { kind: "repository", id: "acme/support" },
    params: { title },
  },
  () => createIssue(title),
);`;

const CLOUD_URL = "https://app.nodrail.com";

/** Where a project's nodrail.yaml points its hosts: this control plane. */
export type ConnectPlace = { workspace: string; environment: string };

/** The `connect:` block for nodrail.yaml, for this workspace and environment. */
export const connectSnippet = (serverUrl: string, place: ConnectPlace) =>
  `connect:
${serverUrl === CLOUD_URL ? "" : `  url: ${serverUrl}\n`}  workspace: ${place.workspace}
  environment: ${place.environment}
  decide: cloud
  enforce: on
  credential: { fromEnv: NODRAIL_CREDENTIAL }`;

/** Plan and apply from the project, with the agent's credential set. */
export const applySnippet = (serverUrl: string) =>
  `export NODRAIL_CREDENTIAL="<the credential above>"
nodrail login${serverUrl === CLOUD_URL ? "" : ` --url ${serverUrl}`}   # your own token, to publish the policy
nodrail plan
nodrail apply`;
