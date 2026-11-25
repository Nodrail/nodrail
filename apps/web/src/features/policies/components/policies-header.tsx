import Link from "next/link";
import { PageTabs } from "@/components/app/page-tabs";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/features/shell/components/page-header";
import { allSections } from "@/features/shell/navigation";
import { appPath } from "@/lib/product-path";
import { ExportRulesLink } from "./export-rules-link";
import { PoliciesMenu, type CopyTarget } from "./policies-menu";

const section = allSections.find((item) => item.slug === "policies");

export type PoliciesTab = "rules" | "gates" | "budgets" | "yaml";

const tabs = [
  { value: "rules", label: "Rules", path: "" },
  { value: "gates", label: "Gates", path: "/gates" },
  { value: "budgets", label: "Budgets", path: "/budgets" },
  { value: "yaml", label: "YAML", path: "/yaml" },
] as const;

/** Each list tab's one primary action: adding an entry of its kind. */
const newEntry = {
  rules: { label: "New rule", path: "/new" },
  gates: { label: "New gate", path: "/gates/new" },
  budgets: { label: "New budget", path: "/budgets/new" },
} as const;

/**
 * Where copying this environment's policies to another starts: that
 * environment's import, with this environment's file in it to review.
 */
export function copyTargets(
  workspace: string,
  environment: string,
  environments: { slug: string; name: string }[],
): CopyTarget[] {
  return environments
    .filter((item) => item.slug !== environment)
    .map((item) => ({
      name: item.name,
      href: `${appPath(workspace, item.slug, "policies/import")}?from=${encodeURIComponent(environment)}`,
    }));
}

/** The YAML tab's actions: all about the file, none of them adds an entry. */
function YamlActions({
  policiesPath,
  copies,
}: {
  policiesPath: string;
  copies: CopyTarget[];
}) {
  return (
    <>
      {copies.map((copy) => (
        <Button key={copy.href} asChild variant="outline">
          <Link href={copy.href}>Copy to {copy.name}…</Link>
        </Button>
      ))}
      <ExportRulesLink href={`${policiesPath}/export`} />
      <Button asChild variant="outline">
        <Link href={`${policiesPath}/import`}>Import YAML</Link>
      </Button>
    </>
  );
}

/**
 * The Policies heading, its actions for people who manage policies, and its
 * tabs: Rules, Gates, Budgets and YAML, each a page of its own. A list tab
 * has one primary action, New, with the rest under More; the YAML tab only
 * acts on the file.
 */
export function PoliciesHeader({
  workspace,
  environment,
  environments,
  canManage,
  current,
}: {
  workspace: string;
  environment: string;
  environments: { slug: string; name: string }[];
  canManage: boolean;
  current: PoliciesTab;
}) {
  const policiesPath = appPath(workspace, environment, "policies");
  const copies = copyTargets(workspace, environment, environments);
  return (
    <>
      <PageHeader
        title="Policies"
        purpose={section?.purpose ?? ""}
        action={
          canManage ? (
            <div data-tour="policies-actions" className="flex flex-wrap gap-2">
              {current === "yaml" ? (
                <YamlActions policiesPath={policiesPath} copies={copies} />
              ) : (
                <>
                  <PoliciesMenu
                    copies={copies}
                    importHref={`${policiesPath}/import`}
                    exportHref={`${policiesPath}/export`}
                  />
                  <Button asChild>
                    <Link href={`${policiesPath}${newEntry[current].path}`}>
                      {newEntry[current].label}
                    </Link>
                  </Button>
                </>
              )}
            </div>
          ) : null
        }
      />
      <PageTabs
        label="Policies view"
        current={current}
        tabs={tabs.map(({ value, label, path }) => ({
          value,
          label,
          href: `${policiesPath}${path}`,
          tour: `policies-tab-${value}`,
        }))}
      />
    </>
  );
}
