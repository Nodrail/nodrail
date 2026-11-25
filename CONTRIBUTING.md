# Contributing to Nodrail server

Open an issue to discuss significant changes. Keep pull requests focused and
include the test commands and results. Use a Conventional Commit title such
as `fix(server): validate a workspace setting`.

The [README](README.md#development) lists the build and development checks.
To run the backend tests, use a dedicated local Postgres 17 test instance on
port 54330 with user `postgres` and password `nodrail_local_only`. Set
`NODRAIL_TEST_DATABASE` to a dedicated database name. The suite recreates
that database, migrates it, and tests using a restricted application role.

```sh
NODRAIL_TEST_DATABASE=nodrail_contrib pnpm test:backend
NODRAIL_TEST_DATABASE=nodrail_contrib NODRAIL_DEPLOYMENT=self-hosted pnpm test:backend
```

This repository is generated from Nodrail's source tree. Accepted changes
come back in the next sync. See [Governance](GOVERNANCE.md) and the
[Code of Conduct](CODE_OF_CONDUCT.md). Contributions are licensed under
[Apache-2.0](LICENSE) as described in section 5 of the license.
