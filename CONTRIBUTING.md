# Contributing to Nodrail

Nodrail/nodrail is the source repository for the server, console, packages and
agent plugins. Open issues and pull requests here. CI and releases run from this
repository. Keep pull requests focused, include the tests you ran, and use a Conventional Commit title such as
`fix(server): validate a workspace setting`. See the
[title convention](https://github.com/Nodrail/.github/blob/main/CONTRIBUTING.md#names-and-descriptions).

## Developer Certificate of Origin

Sign off each commit with `git commit -s` to certify the
[Developer Certificate of Origin](https://developercertificate.org/).
Use the name and email you contributed under. Keep existing sign-offs and add
your own if you are passing on a contribution under the DCO.

## Development

Use Node.js 22 or later and the pnpm version in `package.json`.

```sh
pnpm install --frozen-lockfile
pnpm verify:packages   # types, lint, tests and pack checks for the npm packages
pnpm check
pnpm lint
pnpm test
```

The server and console live in `apps/web`. Source for the npm packages and
agent plugins lives in `packages`. The plugin marketplace is built from
`packages/agent-plugins` and `packages/sdk`.

The backend tests need a dedicated Postgres service and Mailpit. Start the
development services with `docker compose -f apps/web/compose.yaml up -d
postgres-test mailpit`. The suite recreates the database named by
`NODRAIL_TEST_DATABASE`, migrates it and tests with a restricted application
role. The SMTP test sends a message to Mailpit on port 55325 and reads it on 55324.

```sh
NODRAIL_TEST_DATABASE=nodrail_contrib pnpm test:backend
NODRAIL_TEST_DATABASE=nodrail_contrib NODRAIL_DEPLOYMENT=self-hosted pnpm test:backend
```

## Changes and releases

- Add a test for changed behavior. Keep the evaluator free of Node APIs and
  preserve the test vectors in
  `packages/sdk/tests/fixtures/conformance-v1.json`.
- Test new `guard()` integrations with the framework's agent loop and a fake
  model. Examples are in `packages/sdk/tests/client`.
- Add a changeset with `pnpm changeset` for user-facing npm package changes.
  The Release workflow opens a version PR. After it merges, the release
  actor creates the package tags on the merged commit. Dispatch **Release**
  from `main` once per tag to stage it with npm trusted publishing. A
  maintainer approves the stage on npm, then dispatches **Release** with
  `record` to create the GitHub release.

## Marketplace releases

Once the client version is live on npm, update its exact pin in
`packages/agent-plugins/tools/package.json` and its npm lockfile. Merge the
pin and dispatch **Publish marketplace update** from `main`. The workflow
compares both generated hooks with the published client and pushes an update
branch to `Nodrail/agent-plugins`. Open and merge the generated PR once its
checks pass.

Contributions are licensed under [Apache-2.0](LICENSE). Follow the
[Code of Conduct](CODE_OF_CONDUCT.md) and report vulnerabilities privately as
described in [SECURITY.md](SECURITY.md).
