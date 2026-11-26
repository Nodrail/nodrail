"use client";

import { createContext, useContext, type ReactNode } from "react";

type RepositoryProject = { id: string; name: string };
const RepositoryPolicyContext = createContext<RepositoryProject | null>(null);

export const useRepositoryProject = () => useContext(RepositoryPolicyContext);

export function RepositoryPolicy({
  project,
  children,
}: {
  project: RepositoryProject | null;
  children: ReactNode;
}) {
  return (
    <RepositoryPolicyContext value={project}>
      {children}
    </RepositoryPolicyContext>
  );
}

export function RepositoryPublishWarning() {
  const project = useRepositoryProject();
  if (!project) return null;
  return (
    <p className="mt-2 text-ui text-warning">
      Publishing here can put hosts pinned to {project.name}&apos;s lock out of
      sync. Those hosts can deny covered calls until their lock and the live
      policy match again.
    </p>
  );
}
