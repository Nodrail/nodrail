import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardLinks, FactList } from "@/components/app/card";
import { Button } from "@/components/ui/button";
import {
  conditionLabel,
  operationLabel,
  resourceLabel,
  ruleStatusLabels,
} from "@/contracts/v1/policies";
import {
  EffectBadge,
  RevokeRuleButton,
} from "@/features/policies/components/rule-parts";
import { PageTour } from "@/features/guidance/components/page-tour";
import { RuleEnvironmentNote } from "@/features/policies/components/rule-environment";
import { RuleHistory } from "@/features/policies/components/rule-history";
import { PageHeader } from "@/features/shell/components/page-header";
import { loadWorkspaceView, readForPage } from "@/features/shell/load-view";
import { timeAgo } from "@/lib/time";
import { getRule } from "@/server/modules/policies";
import { Note } from "@/components/app/note";
import { appPath } from "@/lib/product-path";

export const metadata: Metadata = { title: "Rule" };

export default async function RulePage({
  params,
}: PageProps<"/app/[workspace]/[environment]/policies/[rule]">) {
  const { workspace, environment, rule: ruleId } = await params;
  const view = await loadWorkspaceView(workspace);
  const rule = await readForPage(workspace, (context) =>
    getRule(context, environment, ruleId),
  );
  const policiesPath = appPath(workspace, environment, "policies");
  const canManage =
    view.capabilities.includes("policies:write") && rule.status !== "revoked";

  return (
    <>
      <PageHeader
        title={rule.name}
        purpose={`Standing rule · changed by ${rule.updatedBy} ${timeAgo(rule.updatedAt)}`}
        back={{ href: policiesPath, label: "Back to policies" }}
        status={
          <span data-tour="rule-decision">
            <EffectBadge effect={rule.effect} />
          </span>
        }
        action={
          canManage ? (
            <CardLinks>
              <Button asChild variant="outline">
                <Link href={`${policiesPath}/${ruleId}/edit`}>Edit</Link>
              </Button>
              <RevokeRuleButton
                workspace={workspace}
                environment={environment}
                rule={rule}
              />
            </CardLinks>
          ) : null
        }
      />
      <RuleEnvironmentNote
        environments={view.environments}
        environment={environment}
      />
      <div className="grid gap-3">
        <Card title="Scope" tour="rule-scope">
          <FactList
            facts={[
              { label: "Status", value: ruleStatusLabels[rule.status] },
              { label: "Agent", value: rule.agentKey ?? "All agents" },
              {
                label: "Installation",
                value: rule.installationName ?? "All installations",
              },
              { label: "Operation", value: operationLabel(rule) },
              { label: "Resource", value: resourceLabel(rule.resource) },
              {
                label: "Conditions",
                value:
                  rule.conditions.map(conditionLabel).join(" · ") || "None",
              },
              {
                label: "Expires",
                value: rule.expiresAt?.slice(0, 10) ?? "Until revoked",
              },
            ]}
          />
          <Note>
            Applies only to matching covered calls. Conditions compare what the
            agent sends, not the current state of the tool.
          </Note>
        </Card>
        <RuleHistory rule={rule} />
      </div>
      <PageTour tour="rule" ready />
    </>
  );
}
