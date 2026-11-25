import type { Role } from "@/contracts/v1/access";

export const roleDescriptions: Record<Role, string> = {
  admin: "Manage the workspace, members, policies and agents.",
  policy_manager: "Manage reusable rules. Cannot invite members.",
  viewer: "Read agents, policies and activity.",
};
