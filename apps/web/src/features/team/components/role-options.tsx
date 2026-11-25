import type { Role } from "@/contracts/v1/access";
import { roleLabels } from "@/features/shell/navigation";
import { roleDescriptions } from "../presentation";

/** A role select's options: each role, and what it may do. */
export function RoleOptions({ roles }: { roles: readonly Role[] }) {
  return roles.map((role) => (
    <option key={role} value={role}>
      {roleLabels[role]} — {roleDescriptions[role]}
    </option>
  ));
}
