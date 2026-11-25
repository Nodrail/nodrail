import type { Metadata } from "next";
import { starterPacks } from "@nodrail/policy-engine/yaml";
import { EmptyState } from "@/components/app/card";
import { PageTour } from "@/features/guidance/components/page-tour";
import { PoliciesHeader } from "@/features/policies/components/policies-header";
import { RuleTable } from "@/features/policies/components/rule-table";
import { StarterPackLink } from "@/features/policies/components/starter-pack-link";
import { loadWorkspaceView } from "@/features/shell/load-view";
import { loadRuleList } from "@/features/policies/load";
import { firstParam } from "@/lib/search-params";
import { plural } from "@/lib/text";
import { ListSummary } from "@/components/app/data-table";
import { FormHint } from "@/components/app/note";
import { appPath } from "@/lib/product-path";

export const metadata: Metadata = { title: "Policies" };

export default async function PoliciesPage({
  params,
  searchParams,
}: PageProps<"/app/[workspace]/[environment]/policies">) {
  const { workspace, environment } = await params;
  const { agent } = await searchParams;
  const view = await loadWorkspaceView(workspace);
  const { rules, agents, lastMatched } = await loadRuleList(
    workspace,
    environment,
  );
  const canManage = view.capabilities.includes("policies:write");
  const importRules = appPath(workspace, environment, "policies/import");
  const active = rules.filter((rule) => rule.status === "active").length;

  return (
    <>
      <PoliciesHeader
        workspace={workspace}
        environment={environment}
        environments={view.environments}
        canManage={canManage}
        current="rules"
      />
      <ListSummary>
        {plural(active, "active rule")} · Unknown actions stay blocked
      </ListSummary>
      {rules.length === 0 ? (
        <EmptyState
          title="No rules yet"
          action={
            canManage ? (
              <div className="stagger mt-3 flex flex-wrap justify-center gap-2">
                {(
                  Object.keys(starterPacks) as (keyof typeof starterPacks)[]
                ).map((key) => (
                  <StarterPackLink
                    key={key}
                    pack={key}
                    href={`${importRules}?pack=${key}`}
                    title={starterPacks[key].summary}
                    label={`Start with ${starterPacks[key].label.toLowerCase()}`}
                  />
                ))}
              </div>
            ) : undefined
          }
        >
          Rules decide what agents may do without asking a person. Until there
          is one, every action is denied.{" "}
          {canManage
            ? "Start from a starter pack and edit it, or write your own with New rule."
            : "An admin can add them."}
        </EmptyState>
      ) : (
        <RuleTable
          workspace={workspace}
          environment={environment}
          rules={rules}
          lastMatched={lastMatched}
          agents={agents.map((item) => item.key)}
          initialAgent={firstParam(agent) ?? ""}
          canManage={canManage}
        />
      )}
      <PageTour tour="policies" ready={rules.length > 0} />
      <FormHint className="mt-2.5">
        Rules apply to calls that reach the configured integration.
      </FormHint>
    </>
  );
}
