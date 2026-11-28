# Security

Please report vulnerabilities privately: [open a private advisory](https://github.com/Nodrail/nodrail/security/advisories/new) (preferred) or write to hello@nodrail.com, with steps to reproduce. Do not open a public issue.

Most useful: a call the engine gets the wrong outcome for, a way to make a governed tool run without an exact allow, a hook that lets a call through when it should block, or a secret that reaches Nodrail unredacted. Include the version, the rules involved, the framework if any, and the call.

Fixes go to the latest release. The [security model](docs/security-model.md) describes what the engine does and doesn't guarantee, and the README's **Limits** and **What guard can't cover** sections list what the client doesn't protect against. Those aren't vulnerabilities, but we'd still like to hear about ways to make them smaller.
