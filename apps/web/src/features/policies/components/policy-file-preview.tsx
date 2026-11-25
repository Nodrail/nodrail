"use client";

import type { ReactNode } from "react";
import { Card, CardActions } from "@/components/app/card";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Note } from "@/components/app/note";
import type {
  PolicyFileIssueDto,
  PolicyFilePreviewDto,
} from "@/contracts/v1/policies";
import { plural } from "@/lib/text";
import { publishPolicyFile } from "../policy-api";

/** A titled group in the preview: problems, or rules added, changed or removed. */
function PreviewGroup({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <>
      <h3 className="mt-3.5 mb-1.5 text-ui font-semibold text-foreground">
        {title}
      </h3>
      <ul className="stagger pl-4.5 text-ui leading-[1.7] [overflow-wrap:anywhere] text-body">
        {children}
      </ul>
    </>
  );
}

function Issues({
  title,
  items,
}: {
  title: string;
  items: PolicyFileIssueDto[];
}) {
  return (
    <PreviewGroup title={title}>
      {items.map((item) => (
        <li key={`${item.line}:${item.column}:${item.message}`}>
          <code>Line {item.line}</code> {item.message}
        </li>
      ))}
    </PreviewGroup>
  );
}

function Names({ title, names }: { title: string; names: string[] }) {
  if (!names.length) return null;
  return (
    <PreviewGroup title={`${title} (${names.length})`}>
      {names.map((name, index) => (
        <li key={`${name}:${index}`}>{name}</li>
      ))}
    </PreviewGroup>
  );
}

/**
 * What a rules file would change, and the confirmed publish of exactly that
 * text at exactly that revision. Shared by Import and Edit as YAML. With
 * `showIssues` off the caller lists the problems itself, as the editor does.
 */
export function PolicyFilePreview({
  workspace,
  environment,
  text,
  preview,
  onApplied,
  title = "Preview",
  showIssues = true,
}: {
  workspace: string;
  environment: string;
  text: string;
  preview: PolicyFilePreviewDto;
  onApplied: () => void;
  title?: string;
  showIssues?: boolean;
}) {
  const { issues, warnings, added, changed, removed, unchanged } = preview;
  const changes = added.length + changed.length + removed.length;
  return (
    <Card title={title} description="Nothing has been published yet.">
      {showIssues && issues.length ? (
        <Issues title="Fix these first" items={issues} />
      ) : null}
      {showIssues && warnings.length ? (
        <Issues title="Warnings" items={warnings} />
      ) : null}
      <Names title="Added" names={added} />
      <Names title="Changed" names={changed} />
      <Names title="Removed" names={removed} />
      {!issues.length ? (
        <Note tone="plain" role="status">
          {changes
            ? `${plural(changes, "change")}, ${unchanged} unchanged.`
            : "These rules already match. There is nothing to publish."}
        </Note>
      ) : null}
      {!issues.length && changes ? (
        <CardActions>
          <ConfirmDialog
            kicker="Publish rules"
            title={`Publish ${plural(changes, "change")}?`}
            triggerLabel="Publish rules"
            triggerVariant="default"
            confirmLabel="Publish rules"
            confirmVariant={removed.length ? "destructive" : "default"}
            action={() =>
              publishPolicyFile({ workspace, environment }, text, preview)
            }
            onSuccess={onApplied}
          >
            <p>
              This becomes the new policy for this environment at once.
              {removed.length
                ? ` ${plural(removed.length, "rule")} not in the file will be removed.`
                : ""}{" "}
              Requests whose outcome changes are closed.
            </p>
          </ConfirmDialog>
        </CardActions>
      ) : null}
    </Card>
  );
}
