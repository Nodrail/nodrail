# @nodrail/sdk

The Nodrail SDK, for code. Compile, test and evaluate agent rules locally with
the open engine at the core of [Nodrail](https://nodrail.com), the open control
plane for AI agent development, and check each tool call against your Nodrail
control plane, self-hosted or Nodrail Cloud. It includes the `nodrail-policy`
command and the Claude Code and Codex hook. For people, the
[`@nodrail/cli`](https://www.npmjs.com/package/@nodrail/cli) command line
`nodrail` declares agents and rules and applies them.

`@nodrail/sdk` continues `@nodrail/policy-engine` and `@nodrail/client`: the
same exports, subpaths and commands in one package. Replace both imports with
`@nodrail/sdk`, for example `@nodrail/policy-engine/yaml` with
`@nodrail/sdk/yaml` and `@nodrail/client/setup` with `@nodrail/sdk/setup`.

**Developer preview:** the API may still change before 1.0. Licensed under
[Apache-2.0](https://github.com/Nodrail/nodrail/blob/main/LICENSE). Report
vulnerabilities privately, as described in [SECURITY.md](SECURITY.md).

## Install

Use Node.js 22 or later.

```sh
npm install @nodrail/sdk
```

For the `nodrail-policy` and `nodrail-claude-hook` commands on your path, install
it globally with `npm i -g @nodrail/sdk`. With pnpm, run `pnpm setup` once first,
then `pnpm add --global @nodrail/sdk`.

## Evaluate rules locally

The engine compiles Nodrail rules files and decides allow or deny for each action an AI agent proposes. The `nodrail-policy` command, the library and the local hook run on the host, with no server or account.

Write and test your first rule with the [policies guide](https://nodrail.com/docs/policies).

### Try a policy locally

Install the SDK globally, as in [Install](#install), for the `nodrail-policy` command.

[`@nodrail/cli`](https://www.npmjs.com/package/@nodrail/cli) installs `nodrail`, Nodrail's one command line. `nodrail policy validate`, `eval` and every other command here behave exactly as `nodrail-policy` does, and `nodrail add` builds a repository's policy from ready-made modules.

In an empty directory, save this as `rules.yaml`.

```yaml
- required_engine_version: 2
- rule: Inspect the working tree
  command: git status
  effect: allow
- rule: Protect untracked files
  command: git clean -fd
  effect: deny
```

```sh
nodrail-policy validate rules.yaml
nodrail-policy eval rules.yaml --command "git status"
nodrail-policy eval rules.yaml --command "git clean -fd"
```

The two evaluations print `allow` and `deny`. Both commands inside the quotes are input to the evaluator. Neither runs. Read `outcome` to inspect a decision. For a script that uses an exit code to gate a command, use `nodrail-policy check`.

### Put the decision before the tool

Use the [local hook](docs/getting-started.md) with Claude Code or [embed the evaluator](docs/library.md) in a harness you maintain. Map supported tool calls consistently so that the same rule has the same meaning in each integration. Treat anything but an allow as blocked, and hand the reason back to the agent.

Building a compatible evaluator? Start with the [conformance fixtures](tests/fixtures/conformance-v1.json) and the [rules reference](docs/rules.md).

### What it does

- **One format for covered tool calls.** An adapter can describe shell commands, file operations, web requests and MCP tools for evaluation.
- **Rules you can review.** Plain YAML with lists, macros and layered files, in the style of [Falco](https://falco.org/docs/concepts/rules/). Validate them and test expected outcomes in CI.
- **Explicit outcomes.** A rule allows or denies, and deny takes precedence over allow. Gates and budgets deny with a reason until they are met, so the agent fixes things and retries; nothing waits for a person. An unmatched action returns `none`. The local hook blocks it by default.
- **Run history (preview).** Level-3 gates and budgets use recorded steps and actions. Read the [preview reference](docs/runs.md) for the required inputs.
- **Hard to talk around.** `g"i"t  push` is judged as `git push`, and `git status; rm -rf /` doesn't match a rule for `git status`.
- **Secrets stay out.** Likely credentials are removed from how a call is described, so rules and reviewers don't see them.
- **Small.** Three runtime dependencies. The evaluator has no Node APIs, so it can run in other JavaScript runtimes.

### What it doesn't do

It decides; it doesn't enforce. A hook or your own code has to act on the answer, and calls that don't pass through it aren't seen. It isn't a sandbox, and an agent that can change its own hook configuration can remove it. Read the [security model](docs/security-model.md) before relying on it.

### Documentation

| Guide                                                   |                                                        |
| ------------------------------------------------------- | ------------------------------------------------------ |
| [Write and test rules locally](docs/getting-started.md) | Write rules and connect Claude Code                    |
| [Rules](docs/rules.md)                                  | Everything a rule file can contain                     |
| [Runs, gates and budgets (preview)](docs/runs.md)       | Rules about what already happened in a run             |
| [Commands and tools](docs/commands-and-tools.md)        | How each kind of call is described and matched         |
| [CLI reference (nodrail-policy)](docs/cli.md)           | Every `nodrail-policy` command                         |
| [CLI reference (nodrail)](https://nodrail.com/docs/cli) | `nodrail`: projects, plan and apply, the control plane |
| [Integrate your own harness](docs/library.md)           | Use the engine from TypeScript                         |
| [Security model](docs/security-model.md)                | What is and isn't guaranteed                           |

### Nodrail

This engine is the open-source core of [Nodrail](https://nodrail.com). `nodrail apply` installs it as a hook on each agent host (Claude Code, Codex, Copilot), where it decides every call locally. The Nodrail control plane, self-hosted or Nodrail Cloud, adds the published policy, runs, receipts, shared budgets and evidence for a team. You don't need a control plane to use the engine.

For a connected project, `nodrail apply` enrolls the machine and saves its
runtime credential for the project and environment at the selected server.
For a local project, `connect: { decide: local }` uses the repository rules.

The hook validates and canonicalizes the origin before looking up the machine
credential. If the environment's policy moves to a different project, the
hook reports the new owner and denies the call in enforcement mode.

### Connected hooks

Connected hooks prefer caller metadata supplied by the host, then the configured entry agent. The control plane admits active declared agents for the enrolled project and uses the enrolled host identity for an undeclared caller. When another project takes over the environment, the old project's hook blocks and names the new owner.

A connected hook reads the machine credential that `nodrail apply` stored for its control-plane origin, workspace, environment and project. For an explicit environment credential, set `NODRAIL_URL` to the issuing origin. Each covered call needs a fresh access response, including in watch mode. The hook includes the server’s admission ID in its decision report. The server uses this evidence and the current access epoch to verify the report. Missing or expired evidence leaves reports visible in unverified history. On Windows, run the hook under the same account that enrolled the machine so it can open the DPAPI-protected credential. On publish skew the hook keeps evaluating verified policy from its own lock. Decision reports contain caller and tool metadata, verdict, rule, policy digest and run references. Set `connect.report_arguments: true` to include redacted arguments and explanations.

## Check calls against Nodrail

Connect your agent’s tools to the Nodrail control plane, self-hosted or Nodrail Cloud, for the published policy, runs, budgets and decision history. A wrapped tool runs only after the client receives a fresh allow for the exact call. A denied request, a timeout or an invalid response blocks that invocation.

For local rules files with no server, see [Evaluate rules locally](#evaluate-rules-locally).

### Quick start

Use Node.js 22 or later. Start with a standalone tool to check your connection, then wrap the tools you already pass to your agent.

#### 1. Get a credential

In Nodrail, open **Agents → Connect an agent**, choose **TypeScript SDK**, and
copy the credential. It is shown once. Each agent gets its own, so a support bot
and a coding bot can follow different rules.

#### 2. Install and configure

```sh
npm install @nodrail/sdk
```

Keep the credential where your other API keys live: your `.env` file in
development, and your host's secret settings in production (Vercel, Railway, AWS
Secrets Manager, a Kubernetes secret, a CI secret).

For a local self-hosted server on the default port, put both settings in your
untracked `.env` file and substitute your own installation credential. For
another deployment, use its origin, including `https://app.nodrail.com` for Cloud.

```dotenv
NODRAIL_URL=http://localhost:3000
NODRAIL_CREDENTIAL=ndr_...
```

For a saved installation credential, put its issuing origin in the adjacent
`url` file under `~/.nodrail/` (or `NODRAIL_HOME`). Existing installations
with only a `credential` file connect to Nodrail Cloud. A URL supplied to the
SDK may use an existing credential only when it matches the credential’s origin.

#### 3. Wrap the tools you already pass to your agent

Before:

```ts
const { text } = await generateText({ model, tools, prompt });
```

After:

```ts
import { guard } from "@nodrail/sdk";

const { text } = await generateText({ model, tools: guard(tools), prompt });
```

That's the whole integration. Full examples, each checked by the type checker on
every change:

| Framework                 | Example                                                             | Pass to `guard`                                                    |
| ------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Vercel AI SDK             | [`vercel-ai-sdk.ts`](examples/client/frameworks/vercel-ai-sdk.ts)   | your `tools` record                                                |
| LangChain, LangGraph      | [`langchain.ts`](examples/client/frameworks/langchain.ts)           | your `tools` array, or use the [middleware](#langchain-middleware) |
| OpenAI Agents SDK         | [`openai-agents.ts`](examples/client/frameworks/openai-agents.ts)   | your `tools` array                                                 |
| Your own loop             | [`plain-function.ts`](examples/client/frameworks/plain-function.ts) | the functions that do the work                                     |
| Mastra                    |                                                                     | a tool or record of tools                                          |
| LlamaIndex                |                                                                     | a tool or array of tools                                           |
| Anthropic SDK tool runner |                                                                     | your `tools` array                                                 |
| Claude Agent SDK          |                                                                     | the tools from `tool()`                                            |
| MCP SDK                   | [`mcp-server.ts`](examples/client/frameworks/mcp-server.ts)         | the server, with `guardMcpServer`, [see below](#mcp-servers)       |
| OpenAI SDK `runTools`     |                                                                     | your `tools` array                                                 |

A framework's tools keep their exact type, so the result goes wherever the
original went. A plain function now returns a promise, since it asks first. If
`guard` doesn't recognise something it throws straight away, so a tool can never
end up looking protected when it isn't.

#### What happens when the agent calls a tool

Before the tool's code runs, the client asks Nodrail whether this agent may make
this call with these arguments. Your team's rules in Nodrail decide:

- **Allowed:** the tool runs as before.
- **Denied:** the tool doesn't run. The agent gets the reason as the tool's
  result, so it can fix what is missing (a gate waiting for a review step, say)
  and try again, or tell the user. A call no rule covers is denied too.

Nothing waits for a person, and every decision is recorded. Rules change in
Nodrail, without a deploy.

#### Try both

In a fresh test workspace, save this as `app.mjs`. Both SDK entry points
request a decision for the same harmless tool.

```js
import { createNodrail, guard, NodrailBlockedError } from "@nodrail/sdk";

function handbook_lookup() {
  return "Start with the public collection.";
}

const tools = guard({ handbook_lookup });
console.log(await tools.handbook_lookup());

const nodrail = createNodrail();
try {
  const result = await nodrail.run(
    {
      tool: "handbook_lookup",
      operation: "call",
      resource: { kind: "tool", id: "handbook_lookup" },
      params: {},
    },
    handbook_lookup,
  );
  console.log(result);
} catch (error) {
  if (!(error instanceof NodrailBlockedError)) throw error;
  console.log(error.message);
}
```

```sh
node --env-file=.env app.mjs
```

Both calls are denied in the empty policy and appear in **Activity**. Under
**Policies**, add this rule in the installation's environment and publish.

```yaml
- rule: Read the demo handbook
  tool: handbook_lookup
  operation: call
  resource: { kind: tool, match: exact, value: handbook_lookup }
  effect: allow
```

Run the same Node command again. Both results now contain the handbook text.

#### In development and tests

Without a credential nothing throws: every guarded call is blocked and says the
credential is missing. In unit tests of the tools themselves, test the unwrapped
tools.

#### LangChain middleware

To cover every tool in a `createAgent` agent, including ones added while it runs:

```ts
import { nodrailMiddleware } from "@nodrail/sdk/langchain";

const agent = createAgent({ model, tools, middleware: [nodrailMiddleware()] });
```

Use this or `guard`. Using both still asks only once.

#### Rules that look inside a call

By default a tool is ruled by its name: tool `send_email`, operation `call`,
resource type `tool` with the name as its id. A name that isn't already
lowercase letters, digits, `_` or `-` gets a short fingerprint (`createIssue`
becomes `createissue-1a2b3c4d`), so prefer snake_case names, or describe the call
yourself.

Rules see the tool's arguments under `input`, so a condition reads
`{ field: input.amount, op: lte, value: 50 }`. Arguments whose names look secret
arrive as `[redacted]`, and inputs over 16 KB arrive only as a fingerprint, so
conditions can't see them.

To write rules about what a tool acts on, say so once:

```ts
guard(tools, {
  describe: {
    create_issue: (input) => ({
      tool: "github",
      operation: "issues.create",
      resource: { kind: "repository", id: (input as { repo: string }).repo },
    }),
  },
});
```

#### MCP servers

Guard the server before registering its tools. Every tool it registers from
then on is checked under the name it registers with:

```ts
import { guardMcpServer } from "@nodrail/sdk";

const server = guardMcpServer(
  new McpServer({ name: "github", version: "1.0.0" }),
);

server.registerTool(
  "delete_repo",
  { inputSchema: { repo: z.string() } },
  async ({ repo }) => deleteRepo(repo),
);
```

The check goes inside each tool the server keeps, so it holds when the server
calls the tool, and a later `tool.update({ callback })` is checked too.
Guarding a server that already has tools throws, rather than leaving them
unchecked. A blocked call answers the MCP client with `isError: true` and the
reason. Tested against the real `@modelcontextprotocol/sdk` client and server.

#### Options

| Option      | Default                    | Meaning                                                                                                                                                      |
| ----------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `onBlocked` | `"return"`                 | `"throw"`, or a function, to change what a blocked tool does. Not used by the LangChain middleware, which always answers with an error message to the model. |
| `describe`  | the tool's name            | What rules see for each tool. `guard` only.                                                                                                                  |
| `name`      | the function's name        | Needed for a function with no name. `guard` only.                                                                                                            |
| `run`       | `NODRAIL_RUN`, else no run | The run calls belong to when no `inRun` or `step` says otherwise. `createNodrail()` only.                                                                    |
| `env`       | `process.env`              | Where `NODRAIL_*` settings are read from. `createNodrail()` only.                                                                                            |
| `fetch`     | the global `fetch`         | The function requests to Nodrail use. `createNodrail()` only.                                                                                                |
| `sleep`     | a timer                    | How the client waits before sending a lost report again, for tests. `createNodrail()` only.                                                                  |

`onBlocked` also goes to `createNodrail()`, which makes an instance with its own
`url`, `credential` and `adapterVersion`. Each request to Nodrail times out
after 10 seconds, and a call is decided at once: nothing waits for a person.

#### Without a framework

```ts
import { createNodrail } from "@nodrail/sdk";

const nodrail = createNodrail();

// Runs only if allowed. Anything else throws NodrailBlockedError.
await nodrail.run(
  {
    tool: "github",
    operation: "issues.create",
    resource: { kind: "repository", id: "acme/support" },
  },
  () => createIssue(),
);

// Or ask, act on the answer yourself, and say how it went.
const decision = await nodrail.check({
  tool: "github",
  operation: "issues.delete",
});
if (decision.allowed) {
  await deleteIssue();
  await nodrail.report(decision, "success");
}
```

A plain string `resource` is resource type `resource`. With no `resource`, it is
type `tool` with the id `<tool>.<operation>`, such as `github.issues.delete`. `run()` and `check()` send
`params` exactly as you pass them, with no redaction: keep secrets out of them.

`run()` takes two more options. `timeoutMs` stops waiting for the call and
reports it as `unknown`, since it may still take effect; an `AbortError` or
`TimeoutError` from the call is reported the same way, any other error as
`failure`. `measure` reads the amounts the result measured, for budgets that
sum a `result.` path; the same list goes to `report(decision, "success", { measured })`.
Amounts are whole, non-negative numbers, each path once; if any isn't, none
is sent, and the budget treats the missing reading as unknown, never zero.
A report is keyed by its permit and retried a few times on a network or
server error, so it never counts twice.

```ts
await nodrail.run(refundAction, () => stripe.refunds.create(args), {
  timeoutMs: 10_000,
  measure: (refund) => [{ path: "result.amount", value: refund.amount }],
});
```

In a run, each call also sends the work revision it is about (`run.subject`,
the git work tree at `cwd`, read again when the permit is issued), so a gate
that needs evidence for this exact commit can be checked. Outside a git work
tree it is sent as unknown, which keeps such a gate closed. Pass
`subject: () => revision` to read it your own way, or `subject: null`.

#### Runs and steps, for any framework

**SDK walkthrough preview.** The examples below use `inRun` and `step`, in every `@nodrail/sdk` version (and `@nodrail/client` 0.2.0 or later).

Gates and budgets decide with what already happened in a piece of work: deny
the pull request until QA passed after the last change, or limit how many tool
calls one agent step makes. Tell Nodrail which run a call belongs to, and wrap
each agent's work as a step:

```ts
const nodrail = createNodrail({ run: "ENG-42" }); // or NODRAIL_RUN

await nodrail.step("dev", () => devAgent.run(task));
const review = await nodrail.step("qa", () => qaAgent.run(task));
await nodrail.step("github", () => releaseAgent.run(task)); // a gate denies its calls until met
```

Every guarded call made while a step runs belongs to it, through your agent
framework's tool loop too, so tools need no change. Steps running side by side
keep their own calls. `nodrail.inRun(key, work)` sets the run for one piece of
work, for a server handling many.

A step's verdict comes from its result: a string ending with a
`nodrail-receipt` block, or an object with `verdict` (and optional `findings`
and `usage: { tokens, usd }`). Pass `{ receipt: (result) => … }` as the third
argument to read your own shape. A step that throws finishes with no verdict,
and the error goes on. Recording a step never stops the work: if it can't be
recorded, gates that need it stay closed.

`step` needs a run, and throws if there is none. Without a run, calls are
decided as before, and any gate they match denies them.

#### Where the connection comes from

Supply `url` and `credential` together in SDK options or set
`NODRAIL_URL` and `NODRAIL_CREDENTIAL` together. With no explicit settings,
the SDK uses the Cloud credential file in `NODRAIL_HOME` (by default
`~/.nodrail`). Addresses use `https`. Loopback addresses (`localhost`,
`127.0.0.1`, `::1`) also accept `http`.

With no credential nothing throws at startup: each guarded call is blocked and
says what is missing, and the next call looks again. So an application that loads
its secrets after importing its tools is checked as soon as they are there.

#### When a call is blocked

The agent reads a sentence saying why, and `NodrailBlockedError.code` (or
`decision.code`) says the same for your code:

| Code                             | What it means                                                                   | What to do                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `DENIED`                         | A rule denies it, no rule allows it, or a gate or budget isn't met              | Meet what the reason says is missing and try again, or change the rule if it should be allowed |
| `EXPIRED`, `INVALIDATED`         | The request timed out, or something changed                                     | Try again for a new decision                                                                   |
| `NOT_CONFIGURED`                 | No credential found                                                             | Pair `NODRAIL_URL` with `NODRAIL_CREDENTIAL`                                                   |
| `UNAUTHENTICATED`                | The credential was refused                                                      | Check it, and that `NODRAIL_URL` points at your Nodrail                                        |
| `RATE_LIMITED`, `QUOTA_EXCEEDED` | Too many calls, or the month's allowance is used                                | Wait, or raise the plan                                                                        |
| `UNAVAILABLE`                    | Nodrail couldn't be reached                                                     | Check the network; nothing ran                                                                 |
| `INSECURE_URL`                   | `NODRAIL_URL` is plain `http` to another machine, so the credential wasn't sent | Use `https`. Plain `http` works only for `localhost`                                           |
| `INVALID_ACTION`                 | The call couldn't be described, for example a circular input                    | Pass plain JSON arguments                                                                      |

#### What guard can't cover

- Tools that run on a provider's servers, such as hosted web search, have no
  function here to check. `guard` leaves only these as they are: anything with
  code of its own (`execute`, `handler`, `invoke`, `run`, `call`, `callback`,
  `func`…) is wrapped, or refused with an error if its shape isn't recognised.
  A tool with two ways to run, such as both `execute` and `run`, is refused
  rather than half checked, and so is an MCP task tool.
- MCP servers attached directly to an agent aren't wrapped. Use the tools from
  your MCP client, or the LangChain middleware.
- Tools that never pass through `guard`, and code outside the agent.

### Rule examples

[`examples/client/policies`](examples/client/policies) holds one rule file per pattern: read one
resource, write only after a reviewer agent passed the work, and deny a
sensitive operation. Try them
without an account using the policy engine's command line:

```sh
npx -p @nodrail/sdk nodrail-policy eval examples/client/policies \
  --tool github --operation issues.read --kind repository --resource acme/support
```

A simulation never issues a permit.

### Compatibility

| Component                                                       | Supported                                 | Checked with                                                                      |
| --------------------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------- |
| Claude Code                                                     | 2.1.295 or later, which adds `onFailure`  | 2.1.322 on macOS, real CLI: a missing, timed-out or crashing hook blocks the tool |
| Codex                                                           | 0.155 or later                            | 0.155.1 on macOS, real CLI                                                        |
| LangChain                                                       | 1.x                                       | 1.6 agent loop                                                                    |
| Vercel AI SDK                                                   | 7                                         | 7.0 agent loop                                                                    |
| OpenAI Agents SDK                                               | 0.21                                      | 0.21 agent loop                                                                   |
| MCP SDK                                                         | 1.x                                       | 1.32 client and server                                                            |
| Mastra, LlamaIndex, Anthropic and OpenAI SDKs, Claude Agent SDK | Recognised by shape                       | Shape only                                                                        |
| Node.js                                                         | 22 or later                               | 22 and 24                                                                         |
| Linux                                                           | Blocking paths checked on Alpine, arm64   | Node 22 in Docker                                                                 |
| Windows                                                         | Supported                                 | Node 22 in CI; the agents' hooks not yet in the real CLIs                         |
| TypeScript consumers                                            | `moduleResolution: bundler` or `nodenext` | TypeScript 7                                                                      |
| Protocol                                                        | schema 1, canonicalizer 1                 |                                                                                   |

How a Claude Code call maps to a rule is part of the contract. A change to it uses
new operation names or resource types, so an existing rule can never silently
start matching something else; at worst it stops matching, and the call is
blocked until the rule is updated.

| Claude Code tool                                                               | Tool          | Operation                                  | Resource                        |
| ------------------------------------------------------------------------------ | ------------- | ------------------------------------------ | ------------------------------- |
| Bash, PowerShell (one simple command)                                          | `shell`       | `command.run`                              | `command`                       |
| Bash, PowerShell (chains, redirects, substitution, or running another program) | `shell`       | `command.compound`                         | `command`                       |
| Write                                                                          | `files`       | `file.write`                               | `file`                          |
| Edit, MultiEdit                                                                | `files`       | `file.edit`                                | `file`                          |
| NotebookEdit                                                                   | `files`       | `notebook.edit`                            | `file`                          |
| WebFetch                                                                       | `web`         | `fetch`                                    | `url`                           |
| WebSearch                                                                      | `web`         | `search`                                   | `query`                         |
| `mcp__server__tool`                                                            | server        | tool                                       | `mcp_tool`                      |
| Agent (starting a subagent)                                                    | `claude-code` | `agent`                                    | `agent`, id the subagent's type |
| Codex `apply_patch` (one file)                                                 | `files`       | `file.write`, `file.edit` or `file.delete` | `file`                          |
| Codex `apply_patch` (several files, or a rename)                               | `files`       | `file.patch`                               | `file`, id `patch:sha256:…`     |
| Any other tool                                                                 | `claude-code` | the tool's name in lowercase               | `tool`                          |

A command, URL or search that contains something that looks like a secret uses
`command.redacted`, `fetch.redacted` or `search.redacted` instead, so a rule for
the plain form can't cover it.

A name that is not already a lowercase key gets a short fingerprint, so `GitHub`
and `github` can never share a rule.

### What leaves your machine

- **File contents:** never. Only a fingerprint and the path.
- **Commands, URLs, searches, MCP and tool inputs:** sent so rules can decide
  them and Activity can show them, with anything that looks like a secret
  replaced by `[redacted]`. The filter is best effort, so keep secrets out of
  them. A fingerprint of the original binds a decision to the exact call.
- **Results:** only whether the tool succeeded and how long it took.
- **Runs:** the run key each call belongs to (`NODRAIL_RUN`, else the
  repository and branch, such as `github.com/acme/app/fix-42`, without
  any credentials in the remote's URL, else the session), the step's
  agent name, and the receipt a step ends with: in Claude Code, the
  `nodrail-receipt` block that ends a subagent's last message, not the rest of
  it; with `nodrail.step()`, the receipt read from the step's result.
- **`run()` and `check()`:** `params` exactly as you pass them, with no
  redaction.

### Limits

- In Claude Code, reads (Read, Grep, Glob) aren't sent to Nodrail. The hook
  checks them on the machine and blocks any that reach a place credentials
  live, such as `.env*`, `~/.ssh` or `*.pem`. The check covers only the tools
  matched in the hook settings: anyone who can edit those settings, or a
  process outside the agent, can go around it. This is not a sandbox.
- File paths are resolved and URLs normalised before rules see them, in the
  machine's own form (`C:\repo\` on Windows). Shell prefix rules are a
  convenience, not a sandbox: prefer exact rules for commands.
- Each installation can make 600 calls a minute.
- A workspace has a monthly allowance of agent actions. Past it, new actions are
  blocked. Checks never stop running and nothing becomes allowed.

### Applied projects

The standalone Claude Code plugin steps aside when `nodrail apply` has recorded the verified project hook in the user's home directory and the installed settings and policy files still match. Start a new session after installing a project hook. Set `NODRAIL_REQUIRE_STANDALONE=1` to require standalone authorization as well.

Set `NODRAIL_URL` and `NODRAIL_CREDENTIAL` together, or set both values in the Claude Code plugin options. Incomplete or conflicting pairs block governed calls. A saved credential file uses the Cloud origin.

## The Claude Code and Codex hook

Install the plugin instead: see
[Nodrail/agent-plugins](https://github.com/Nodrail/agent-plugins). No code changes, and the
checks cover the shell, file edits and MCP tools.

The one-file hook is also here, for setting up by hand: `dist/nodrail-hook.mjs`
(also installed as the command `nodrail-claude-hook`), with the argument `codex`
for Codex. `@nodrail/sdk/setup` exports the hook settings for both agents
(`claudeCodeHooks`, `codexHooks`). The connect page in Nodrail shows them filled
in.

The Claude Code hook sends each intent with its run and the subagent taking it,
governs starting a subagent (`Agent`, or `Task` in older Claude Code), and
records `SubagentStart` and `SubagentStop` as steps with the receipt block the
subagent ended with (read from the last 16 KB of its message, up to 8 KB). The
run is `NODRAIL_RUN`, else `<repo>/<branch>` where the session started, such as
`github.com/acme/app/fix-42`, kept for the whole session so switching
branch doesn't change it; on the default branch or outside git it is the
session. The pin is kept in `.git/nodrail/sessions`. Gates and budgets in your rules use
that history. Any other agent uses
[runs and steps](#runs-and-steps-for-any-framework) in the SDK.

**Upgrading:** starting a subagent used to be ungoverned by the plugin. It is
now tool `claude-code`, operation `agent`, with the subagent's type as a
resource of type `agent` (`vercel:deployment-expert` becomes
`vercel-deployment-expert`). Until a rule allows it, each start is denied.
Rule files with a rule for the earlier resource, type `tool` with id
`Agent`, no longer compile.

The Codex hook sends the run the same way. Codex doesn't say which subagent
makes a call, so every call is the main agent's: gates on commands (such as
`git push`) and budgets per run work, and a gate waiting for another agent's
step stays unmet, and the call is denied, until that step is recorded some other way, for example with
`nodrail.step()` in a script.

To see each outcome, add these rules under **Policies**, then ask the agent
to run the commands:

| Outcome           | Rule                                                                             | Command                 |
| ----------------- | -------------------------------------------------------------------------------- | ----------------------- |
| Allowed by a rule | Allow `shell` `command.run`, resource type `command`, starting with `git status` | `git status`            |
| Denied, no rule   | No rule needed                                                                   | `npm publish --dry-run` |
| Denied by a rule  | Deny `shell` `command.run`, resource type `command`, exactly `git push`          | `git push`              |

## Contributing

See [CONTRIBUTING.md](https://github.com/Nodrail/nodrail/blob/main/CONTRIBUTING.md). Please report vulnerabilities privately, as described in [SECURITY.md](SECURITY.md).

The engine suite runs Windows, macOS and Linux secret-store paths on every
host with injected OS operations, alongside the native tests.

## License

[Apache-2.0](https://github.com/Nodrail/nodrail/blob/main/LICENSE)
