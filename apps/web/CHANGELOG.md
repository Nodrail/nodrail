# Server changelog

## Unreleased

- Moved public source and releases to [Nodrail/nodrail](https://github.com/Nodrail/nodrail). Public CI starts Mailpit for the real SMTP notification test.
- Isolated the pinned Cloud build, database migration and Vercel upload so each runs with only the inputs and credentials it needs.

- Refresh the filtered first-check Activity view for up to a minute and show a retry hint if the report has yet to arrive.
- Document the agent credential scope required by the runtime identity endpoint.

- Admission proofs carry a signing key ID and expire after seven days by default. Key rotation preserves pause replay. Account erasure can finish during SMTP, and the worker records accepted sends on the scrubbed outbox row.

- Verify host decisions with per-call server admission, match first checks by exact token, and order SMTP sends with erasure under a bounded lease. SMTP acceptance followed by a crash before database commit can still trigger a retry when that lease expires.

- Match the first project check by its redacted correlation token. Show the Claude Code entry agent in the pause dialog and record paused calls in Activity and existing runs.

- Clarify agent and machine pause guarantees, label late host reports as unverified history, and fence notification enqueue and delivery against account erasure.

- Show disconnected hosts immediately in Inventory and retain their last observation.
- Give each environment a copyable project connect command, and preserve policy versions across host-only workspace lock changes.

- Deny unidentified callers while applicable agent access is paused. Record verified pre-pause reports without creating runs or steps.
- Fence notification delivery against account erasure. Count connected installations and paused identities, preserve the v1 installation object, and group removed catalog rules by live provenance.

- Enforce pause at both the declared agent and machine levels. Show declared agents with their machines and identify fallback callers separately.
- Preserve resolved callers in run summaries and timelines. Allow an enrolled machine to revoke its own credential when it disconnects.
- Report policy-only counts in the connected preview. Guide Inventory users to apply for the first report.

- Keep enrolled machine scopes for budget and evidence access across all supported pins of the same project and environment.

- Enforce project ownership, explicit policy takeovers and enrollment revocation. Validate and pin evidence and contracts when publishing a locked project.

- Added browser CLI sessions and declarative policy publication with project agent registration, intended revisions and per-machine enrollment.

- Enrolled hosts reject foreign policy and evidence pins and receive the new project owner's name after an environment takeover. Inventory heartbeats preserve full observations.

- Host access, Activity and shared budgets use the caller admitted by the enrollment. Added machine-authenticated Inventory and watch-mode Activity verdicts.

- Added project-first setup for Claude Code, Codex and GitHub Copilot CLI, plus separate setup for standalone plugins, hooks and SDKs.
- Keep repository warnings visible after console publications and recheck ownership before publishing.
- Show the project setup CLI requirement, guide Codex to enrollment, and verify each setup with a unique Activity query.
- Show reporting authorization headers and display effective token scopes without marking an issued token used.
- Count server-recorded gate denials in Insights and show how to recover when an environment reaches its rule limit.
- Made reporting tokens exclusive, clarified token validation and effective access, and added environment-specific OpenTelemetry endpoints.
- Preserved the Activity view and last working environment across navigation, required a fresh policy preview after editing an import, and preserved invitations through signup.
- Accept whitespace around the configured proxy header name and report invalid names in readiness and sign-in. Document password entry over stdin for container bootstrap.

- Added separate server and migration images, plus Docker Compose and Helm packaging for standalone Postgres.
- Made self-hosting the default. Cloud explicitly selects Stripe-backed entitlements and metering.
- Made analytics opt-in and removed the waitlist endpoint and retention queries. Fresh databases skip its tables. Existing tables stay available during rolling upgrades.
- Added the public release workflow for signed multi-platform GHCR images with provenance and an SBOM. It verifies the release tag against protected main before publishing.

- Report missing or invalid trusted proxy headers in readiness and on the self-hosted sign-in form.

See [Compatibility](COMPATIBILITY.md) for the source baseline.
