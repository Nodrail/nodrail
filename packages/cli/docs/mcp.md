# nodrail mcp

`nodrail mcp` runs [Nodrail](https://nodrail.com) as an MCP server: ask Claude Code, or any MCP
client, what an agent did, why a call was denied, or what your rules file
says. It reads your Nodrail control plane, self-hosted or Nodrail Cloud,
through the management API. It runs over stdio with a personal API token, and
it is read-only unless you opt in.

## Read this first: who changes the rules

Nodrail's rules allow or deny what an agent may do, and nothing waits for a
person. The rules are yours to change, not the agent's.

**Never give this server a token with `rules:write` when it runs inside an
agent that Nodrail governs.** That agent could publish rules that allow what
Nodrail denies. Nothing on the server can tell your request from the agent's:
both arrive with your token.

- Use a `read` token. That is all the read tools need.
- The publishing tool exists only when you start the server with
  `--allow-publish` **and** the token has the scope **and** your role allows
  it. Leave the flag off unless you are the one at the keyboard and the
  assistant is not itself governed by Nodrail.
- Even then, never auto-approve `publish_rules` in your client. When the
  client supports MCP elicitation, the server asks you to confirm each call
  itself and does nothing if you decline. A client that can't ask gets no
  publish at all, unless you also pass `--client-confirms` to say its own
  per-call permission prompt is on.
- Everything published is recorded as you, "via API token _name_", in
  Activity.

## Set up

Create a token in Nodrail under **your account → API tokens** (the menu on your avatar) with only `read`.
Requires Node.js 22 or later. With the CLI installed, `nodrail mcp` works in place of `npx -y @nodrail/cli mcp`.

### Claude Code

```sh
claude mcp add nodrail --env NODRAIL_TOKEN=ndp_… -- npx -y @nodrail/cli mcp
```

Or in a project's `.mcp.json` (keep the token out of the repository: Claude
Code expands `${NODRAIL_TOKEN}` from your environment):

```json
{
  "mcpServers": {
    "nodrail": {
      "command": "npx",
      "args": ["-y", "@nodrail/cli", "mcp"],
      "env": { "NODRAIL_TOKEN": "${NODRAIL_TOKEN}" }
    }
  }
}
```

### Other MCP clients

Most clients take the same `mcpServers` entry:

```json
{
  "mcpServers": {
    "nodrail": {
      "command": "npx",
      "args": ["-y", "@nodrail/cli", "mcp"],
      "env": { "NODRAIL_TOKEN": "ndp_…" }
    }
  }
}
```

Without `NODRAIL_TOKEN`, the server uses the token saved by
`nodrail login`. Set
`NODRAIL_URL` for a self-hosted Nodrail: `NODRAIL_TOKEN` is only sent to that
address (or to Nodrail Cloud), never to a different `--url`, and tokens only
travel over https, except to `localhost`. Add
`"--environment", "production"` to `args` for an environment other than the
workspace's default.

### Opting in to publishing

Only for a person's own assistant, never for a governed agent, with a token
that has the scope:

```json
{
  "mcpServers": {
    "nodrail": {
      "command": "npx",
      "args": ["-y", "@nodrail/cli", "mcp", "--allow-publish"],
      "env": { "NODRAIL_TOKEN": "${NODRAIL_PUBLISH_TOKEN}" }
    }
  }
}
```

## Tools

Always available:

| Tool                   | What it does                                                               |
| ---------------------- | -------------------------------------------------------------------------- |
| `whoami`               | The token's person, workspace, role, scopes and environments               |
| `search_activity`      | Activity with its filters: `q`, `agent`, `outcome`, `kind`, `range`, `run` |
| `get_activity_event`   | One event, with the action's parameters and reports                        |
| `list_runs`, `get_run` | Runs, and one run's timeline                                               |
| `get_rules_yaml`       | The active rules file                                                      |
| `get_insights`         | Decision and rule numbers                                                  |

Only when the token can publish rules:

| Tool            | What it does                                                                   |
| --------------- | ------------------------------------------------------------------------------ |
| `preview_rules` | Checks a rules file and says what publishing it would change. Changes nothing. |

Preview needs `rules:write` because Nodrail treats it as the first half of
publishing: it shows the publish plan and returns the revision and digest a
publish must name. To only check that a file is valid, use
[`nodrail-policy validate`](https://nodrail.com/docs/cli) locally.

Only with `--allow-publish` and a token that can publish:

| Tool            | What it does                                          |
| --------------- | ----------------------------------------------------- |
| `publish_rules` | Publishes a file exactly as `preview_rules` showed it |

Fields named `parameters` and `details` hold what agents sent. The tools say
so, but an assistant can still be misled by text an agent wrote: that is one
more reason the publishing tool stays off by default.
