import { Note } from "@/components/app/note";

/** An environment's name by its slug, or the slug when it isn't listed. */
export const environmentName = (
  environments: { slug: string; name: string }[],
  slug: string,
) => environments.find((item) => item.slug === slug)?.name ?? slug;

/** Under a policy form's heading: the one environment it publishes to. */
export function RuleEnvironmentNote({
  environments,
  environment,
}: {
  environments: { slug: string; name: string }[];
  environment: string;
}) {
  return (
    <Note data-tour="rule-environment">
      Applies in {environmentName(environments, environment)} only. Each
      environment has its own policies.
    </Note>
  );
}
