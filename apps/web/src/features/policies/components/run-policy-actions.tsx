"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { track } from "@/components/analytics/posthog";
import { RowActions } from "@/components/app/row-actions";
import { Button } from "@/components/ui/button";
import type { RunPolicyChange } from "@/contracts/v1/runs";
import { changeRunPolicyAction } from "../actions";

/** A gate's or budget's Edit button and "⋯" menu, with removal confirmed first. */
export function RunPolicyActions({
  workspace,
  environment,
  revision,
  listPath,
  kind,
  id,
  name,
}: {
  workspace: string;
  environment: string;
  revision: number;
  listPath: string;
  kind: RunPolicyChange["kind"];
  id: string;
  name: string;
}) {
  const router = useRouter();
  const edit = `${listPath}/${id}/edit`;
  const noun = kind === "gate" ? "gate" : "budget";
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <Button asChild variant="outline" size="sm">
        <Link href={edit} aria-label={`Edit ${name}`}>
          Edit
        </Link>
      </Button>
      <RowActions
        name={name}
        items={[
          { label: "Edit", href: edit },
          "separator",
          {
            label: "Remove…",
            destructive: true,
            confirm: {
              kicker: `Remove ${noun}`,
              title: `Remove “${name}”?`,
              confirmLabel: `Remove ${noun}`,
              action: () =>
                changeRunPolicyAction(
                  workspace,
                  environment,
                  { kind, id, entry: null },
                  revision,
                ),
              onSuccess: () => {
                track(`${kind}_removed`);
                router.refresh();
              },
              children: (
                <p>
                  {kind === "gate"
                    ? "The action no longer waits for these steps. Your rules still decide it."
                    : "Runs are no longer stopped by this limit."}{" "}
                  This publishes a new policy version; earlier versions stay in
                  history.
                </p>
              ),
            },
          },
        ]}
      />
    </div>
  );
}
