# Security

Please report vulnerabilities privately, through
[GitHub's private reporting](https://github.com/Nodrail/nodrail/security/advisories/new)
or to hello@nodrail.com, with steps to reproduce. Do not open a public issue.

Most useful: a way to make the command decide or publish without a person
confirming, `nodrail mcp` offering its publishing tool without
`--allow-publish` and the token's scope, a token written somewhere other
people can read, or a token sent anywhere but the Nodrail address you chose.
Include the version and the command (and the MCP client, for `nodrail mcp`).

Fixes go to the latest release. That an assistant given `--allow-publish` can
be talked into publishing by text an agent wrote is why the flag exists and is
off by default, not a vulnerability.
