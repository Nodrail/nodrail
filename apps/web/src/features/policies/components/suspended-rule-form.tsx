import type { ComponentProps } from "react";
import { Suspense } from "react";
import {
  CardActionsSkeleton,
  CardSkeleton,
  FormFieldSkeleton,
  LoadingPage,
  skeletonKeys,
} from "@/components/app/skeletons";
import { loadRulesAndAgents, loadSuggestions } from "../load";
import { RuleForm, type RuleWhere } from "./rule-form";

/** A rule form while it loads, for a new rule or an edit. */
function RuleFormSkeleton({ label }: { label: string }) {
  return (
    <LoadingPage label={label}>
      <CardSkeleton>
        <div className="grid gap-3.5">
          {skeletonKeys(6).map((index) => (
            <FormFieldSkeleton key={index} hint={index % 2 === 0} />
          ))}
          <CardActionsSkeleton buttons={2} />
        </div>
      </CardSkeleton>
    </LoadingPage>
  );
}

type FormProps = Omit<
  ComponentProps<typeof RuleForm>,
  "agents" | "rules" | "suggestions" | "where"
> &
  RuleWhere;

async function LoadedRuleForm({
  workspace,
  environment,
  environmentName,
  ...form
}: FormProps) {
  const [{ rules, agents }, suggestions] = await Promise.all([
    loadRulesAndAgents(workspace, environment),
    loadSuggestions(workspace, environment),
  ]);
  return (
    <RuleForm
      {...form}
      where={{ workspace, environment, environmentName }}
      agents={agents}
      rules={rules}
      suggestions={suggestions}
    />
  );
}

/**
 * The rule form, once the rules and agents it checks against have loaded.
 * Its page checks the address first, so only this part waits.
 */
export function SuspendedRuleForm({
  label,
  ...props
}: FormProps & { label: string }) {
  return (
    <Suspense fallback={<RuleFormSkeleton label={label} />}>
      <LoadedRuleForm {...props} />
    </Suspense>
  );
}
