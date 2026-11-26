import "server-only";
import type { ReactNode } from "react";
import { Note } from "@/components/app/note";
import { RepositoryPolicy } from "./components/repository-policy";
import { readForPage } from "@/features/shell/load-view";
import { readRepositoryProject } from "@/server/modules/policies/repository";

export async function EnvironmentRepositoryPolicy({
  workspace,
  environment,
  children,
}: {
  workspace: string;
  environment: string;
  children: ReactNode;
}) {
  const project = await readForPage(workspace, (context) =>
    readRepositoryProject(context, environment),
  );
  return (
    <RepositoryPolicy project={project}>
      {project ? (
        <div className="mb-4">
          <Note tone="plain">
            <strong>Repository policy for {project.name}.</strong> To keep
            pinned hosts in sync, edit the policy in that project, lock it, and
            run <code>nodrail apply</code>.
          </Note>
        </div>
      ) : null}
      {children}
    </RepositoryPolicy>
  );
}
