/**
 * The policy engine's declared-contracts module (dialect 1): one validator,
 * one projection and one digest for the CLI, the hooks and this server,
 * through the engine's public subpath. Plain TypeScript, so
 * pages may use it too; code that only checks values can take
 * `@nodrail/policy-engine/contract-values`, which has no dependencies.
 */
export * from "@nodrail/policy-engine/contracts";
