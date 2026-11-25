# Changelog

## Unreleased

### Removed

- `list_pending_approvals`, `get_approval`, `decide_approval` and the
  `--allow-decisions` flag: nothing waits for a person, so there is nothing
  to approve. A rule allows or denies.

## 0.1.0

First release: Nodrail as an MCP server over stdio, with a personal API token
(`ndp_…`).

- Read tools: `whoami`, `list_pending_approvals`, `get_approval`,
  `search_activity`, `get_activity_event`, `list_runs`, `get_run`,
  `get_rules_yaml` and `get_insights`.
- `preview_rules` when the token can publish rules.
- `decide_approval` only with `--allow-decisions`, and `publish_rules` only
  with `--allow-publish`, each also needing the token's scope and the person's
  role. Both ask the person to confirm through MCP elicitation when the client
  supports it.
