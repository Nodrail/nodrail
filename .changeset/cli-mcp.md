---
"@nodrail/cli": minor
---

Add `nodrail mcp`: Nodrail as an MCP server over stdio, which replaces the never-published `@nodrail/mcp` package. Read tools (`whoami`, `search_activity`, `get_activity_event`, `list_runs`, `get_run`, `get_rules_yaml`, `get_insights`), `preview_rules` when the token can publish rules, and `publish_rules` only with `--allow-publish`, the token's scope and the person's role, confirmed through MCP elicitation. Set up with `claude mcp add nodrail --env NODRAIL_TOKEN=ndp_… -- npx -y @nodrail/cli mcp`; see `docs/mcp.md`.
