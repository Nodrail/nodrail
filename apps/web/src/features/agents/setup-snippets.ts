import { claudeCodeHooks, governedTools } from "@nodrail/client/setup";

export { governedTools };

export const claudeCodeSettings = (hookCommand: string) => ({
  hooks: claudeCodeHooks({ command: hookCommand }),
});

/** Where the plugins are published from. */
const PLUGINS = "Nodrail/agent-plugins";

export const claudeCodePluginSnippet = `/plugin marketplace add ${PLUGINS}
/plugin install nodrail@nodrail`;

export const environmentSnippet = (serverUrl: string) =>
  `export NODRAIL_URL="${serverUrl}"\nexport NODRAIL_CREDENTIAL="<the credential above>"`;

export const sdkEnvironmentSnippet = (serverUrl: string) =>
  `NODRAIL_URL="${serverUrl}"\nNODRAIL_CREDENTIAL="<the credential above>"`;

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

export type ConnectPlace = { workspace: string; environment: string };

export const projectRuntimes = [
  { key: "claude-code", label: "Claude Code", command: "claude" },
  { key: "codex", label: "Codex", command: "codex" },
  { key: "copilot", label: "GitHub Copilot CLI", command: "copilot" },
] as const;

export type ProjectRuntime = (typeof projectRuntimes)[number]["key"];

export const connectCommand = (
  serverUrl: string,
  place: ConnectPlace,
  runtime: ProjectRuntime,
) =>
  `nodrail connect ${serverUrl} --workspace ${place.workspace} --environment ${place.environment} --runtime ${runtime}`;

export const connectSnippet = (serverUrl: string, place: ConnectPlace) =>
  `connect:
  url: ${serverUrl}
  workspace: ${place.workspace}
  environment: ${place.environment}
  decide: cloud
  enforce: on`;

export const applySnippet = (runtime: ProjectRuntime) =>
  `nodrail apply --runtime ${runtime}`;
