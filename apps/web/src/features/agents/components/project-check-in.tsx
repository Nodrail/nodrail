import { Card } from "@/components/app/card";
import { CodeBlock } from "@/components/app/inert-json";
import { TextLink } from "@/components/app/text-link";
import { activityHref, clearedQuery } from "@/features/activity/filters";
import type { ProjectRuntime } from "../setup-snippets";

export function ProjectCheckIn({
  activityPath,
  environmentName,
  host,
  marker,
  runtime,
}: {
  activityPath: string;
  environmentName: string;
  host: string;
  marker: string;
  runtime: ProjectRuntime;
}) {
  const activity = activityHref(activityPath, {
    ...clearedQuery,
    kind: "decisions",
    range: "24h",
    check_token: marker,
  });
  return (
    <Card title="Verify the first check-in">
      <p className="mb-2 text-ui">
        Open <code>{host}</code> in this project and ask it to attempt this
        exact terminal command.
      </p>
      <CodeBlock aria-label="Check-in command">{`echo ${marker}`}</CodeBlock>
      <p className="mt-2 text-ui">
        Open <TextLink href={activity}>Activity for this check</TextLink> in{" "}
        {environmentName}. The filter matches the check token. Confirm the
        calling agent or host identity and the time of your attempt. An allow or
        deny confirms the hook reported. If this check is missing, run{" "}
        <code>nodrail status --runtime {runtime}</code> and verify the server
        URL and environment in <code>nodrail.yaml</code>. The project reports to
        Inventory automatically.
      </p>
    </Card>
  );
}
