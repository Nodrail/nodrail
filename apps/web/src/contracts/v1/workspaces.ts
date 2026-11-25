import { z } from "zod";
import type { Capability, Role } from "./access";

export const createWorkspaceInput = z
  .object({ name: z.string().trim().min(1).max(120) })
  .strict();

export type WorkspaceSummaryDto = {
  id: string;
  name: string;
  slug: string;
  role: Role;
};

export type EnvironmentDto = { id: string; slug: string; name: string };

export type WorkspaceViewDto = WorkspaceSummaryDto & {
  isOwner: boolean;
  capabilities: Capability[];
  environments: EnvironmentDto[];
  defaultEnvironmentId: string | null;
  otherWorkspaces: WorkspaceSummaryDto[];
  person: { id: string; name: string; email: string | null };
};
