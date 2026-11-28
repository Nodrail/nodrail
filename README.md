# Nodrail: the open control plane for AI agent development

Nodrail keeps your agents' setup and rules in your repository and decides every agent action before it runs. `nodrail.yaml`, the rules files it imports and `nodrail.lock.yaml` are the desired state. `nodrail plan` shows what would change on each agent host (Claude Code, Codex, Copilot). `nodrail apply` sets it up, with a hook that allows or denies each action using the open engine. This is the source repository for the server and console, policy engine, CLI, TypeScript client, MCP server and agent plugins. Development, issues, pull requests, CI and releases live here.

[![CI](https://github.com/Nodrail/nodrail/actions/workflows/ci.yml/badge.svg)](https://github.com/Nodrail/nodrail/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/Nodrail/nodrail/badge)](https://scorecard.dev/viewer/?uri=github.com/Nodrail/nodrail)
[![OpenSSF Best Practices](https://www.bestpractices.dev/projects/16692/badge)](https://www.bestpractices.dev/projects/16692)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Set up a project

Install the CLI with Node.js 22 or later, copy the example team and set it up on Claude Code.

```sh
npm install -g @nodrail/cli
nodrail example support-desk ./desk
nodrail plan ./desk --runtime claude-code    # what apply would set up, starting nothing
nodrail apply ./desk --runtime claude-code   # set it up, after showing the plan
```

Read the [CLI README](packages/cli/README.md) for `nodrail.yaml`, the catalog and the lock.

## Try a rules file

Install the engine with Node.js 22 or later.

```sh
npm install -g @nodrail/sdk
```

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

## Use the same policy in your harness

The Claude Code local hook reads your rules before covered tools run. You can also compile the file in your own harness, map proposed calls to action descriptors and invoke the tool only after a matching allow. Portability depends on the actions and facts the integration supplies.

- [Connect the local Claude Code hook](packages/sdk/docs/getting-started.md).
- [Embed the evaluator](packages/sdk/docs/library.md) or use the [published test cases](packages/sdk/tests/fixtures/conformance-v1.json) when building a compatible evaluator.
- [Check integration coverage](https://nodrail.com/integrations), including the Codex plugin.

## GitHub merge check (pilot)

We used the engine in a local adapter to evaluate QA evidence for a pull request. The adapter matched the receipt to the revision under review and posted a status to that commit. GitHub required the status on the pilot branch. A formatting-only push needed a fresh receipt before the PR was eligible to merge again. [Read the pilot case study](https://nodrail.com/guides/github-merge-check-ai-agent-qa) · [Inspect PR #11](https://github.com/Nodrail/agent-plugins/pull/11).

## Packages

| Package                                            | When to use it                                                                                                                                                                                                    |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@nodrail/cli`](packages/cli)                     | Declare agents and rules in `nodrail.yaml`, then plan and apply them on Claude Code, Codex and Copilot.                                                                                                           |
| [`@nodrail/sdk`](packages/sdk)                     | Compile and evaluate rules locally, test them in CI or decide calls in your own harness, no account required. Check wrapped tools against the policy in your Nodrail control plane, self-hosted or Nodrail Cloud. |
| [`@nodrail/agent-plugins`](packages/agent-plugins) | Build the plugins distributed through the [generated marketplace](https://github.com/Nodrail/agent-plugins).                                                                                                      |

## Connect a team workspace

The control plane is the open Nodrail server, self-hosted or Nodrail Cloud. It keeps the published policy, runs, receipts, decisions, shared budgets and evidence. Run the server and console yourself with Docker Compose or Kubernetes.

In the directory with your connected `nodrail.yaml`, log in to your control plane
and apply the project. Replace the Cloud URL below with your server’s origin
if you self-host.

```sh
nodrail login --url https://app.nodrail.com
nodrail apply
```

Apply publishes the project's locked policy, registers its agents and enrolls
this machine for the declared workspace and environment.

## SDK and CI integrations

Create a Nodrail credential in **Agents → Connect an agent**. Configure it as an environment secret on the server or CI runner where the tools run. Pass the guarded tools to your agent.

```ts
import { guard } from "@nodrail/sdk";

const agent = createAgent({ model, tools: guard(tools) });
```

This excerpt assumes your framework already supplies `createAgent`, `model` and `tools`. Read the [client quickstart](packages/sdk/README.md) for installation, credentials and supported tool shapes. For an existing coding agent, see the [Claude Code and Codex plugins](https://github.com/Nodrail/agent-plugins).

## Self-host the server

The [self-hosting guide](https://nodrail.com/docs/self-hosting) covers
installation, upgrades and verification of released images. To build the server
and migration images locally from a checkout, run these from the repository root.

```sh
docker build -f apps/web/Dockerfile -t nodrail-local/server:dev .
docker build -f apps/web/Dockerfile --target server-migrate -t nodrail-local/server-migrate:dev .
```

Use [the Compose template](apps/web/deploy/.env.example) with
`NODRAIL_REGISTRY=nodrail-local` and `NODRAIL_VERSION=dev`, or see the
[Helm chart](apps/web/deploy/helm/nodrail/README.md) for Kubernetes.

For Compose, after the migration service completes, choose and securely save
a password of 12 to 256 characters. Replace the example email with yours and
enter the password at the hidden prompt.

```sh
printf 'First account password: ' >&2
IFS= read -rs NODRAIL_BOOTSTRAP_PASSWORD
printf '\n' >&2
printf '%s' "$NODRAIL_BOOTSTRAP_PASSWORD" |
  docker compose run --rm -T --entrypoint pnpm migrate admin:create --email you@example.com
unset NODRAIL_BOOTSTRAP_PASSWORD
```

Open `APP_ORIGIN`, sign in and create a workspace. Follow the
[first protected call walkthrough](https://nodrail.com/docs/self-hosting#make-a-protected-call)
to connect a repository and verify an allow and a deny. Set `SMTP_URL` and
`NOTIFICATIONS_FROM` to enable sign-in links, verified signup and password
reset email.

## Enforcement and failure behavior

The engine returns a decision. The harness controls execution. Code with a direct route to a tool can bypass the check. The client blocks a wrapped call when authorization fails or times out. Each plugin documents the behavior of its runtime when the hook itself cannot start. [Security model](packages/sdk/docs/security-model.md).

## Status

Developer preview. The API may change before 1.0, following semantic versioning
and the [changelogs](packages/sdk/CHANGELOG.md).

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md). Please report vulnerabilities privately,
as [SECURITY.md](SECURITY.md) describes.

## License

[Apache-2.0](LICENSE)
