import { environmentQuery } from "@/contracts/v1/public-api";
import { memberRoleBody } from "@/contracts/v1/management";
import { parseInput } from "@/server/db/context";
import { changeMemberRole, removeMember } from "@/server/modules/team/members";
import { publicRoute } from "@/server/public-api/route";

export const PATCH = publicRoute<{ id: string }>(
  { scope: "members:manage", access: "write", query: environmentQuery },
  (context, call) =>
    changeMemberRole(context, {
      userId: call.params.id,
      role: parseInput(memberRoleBody, call.body).role,
    }),
);

export const DELETE = publicRoute<{ id: string }>(
  { scope: "members:manage", access: "write", query: environmentQuery },
  (context, call) => removeMember(context, call.params.id),
);
