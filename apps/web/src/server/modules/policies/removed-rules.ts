import "server-only";
import { catalogRuleIds, compilePolicies } from "@nodrail/policy-engine/yaml";
import type { PolicyRule } from "@/server/db/entities";
import { logicalIdFor } from "./logical-id";

function liveCatalogIds(environmentId: string, source: string | null) {
  if (!source) return new Set<string>();
  const compiled = compilePolicies([{ name: "rules.yaml", text: source }]);
  if (!compiled.ok) return new Set<string>();
  return new Set(
    [...catalogRuleIds(source, compiled.rules)].map((id) =>
      logicalIdFor(environmentId, id),
    ),
  );
}

export function removedRules(
  live: { rules: PolicyRule[]; sourceText: string | null },
  environmentId: string,
  kept: ReadonlySet<string>,
) {
  const removed = live.rules.filter(
    ({ logicalRuleId }) => !kept.has(logicalRuleId),
  );
  const catalog = removed.length
    ? liveCatalogIds(environmentId, live.sourceText)
    : new Set<string>();
  return {
    removed: removed.map(({ name }) => name),
    catalogRemoved: removed
      .filter(({ logicalRuleId }) => catalog.has(logicalRuleId))
      .map(({ name }) => name),
  };
}
