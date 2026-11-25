import { revokeInvite } from "@/server/modules/team/invites";
import { idAction } from "@/server/public-api/route";

export const POST = idAction("members:manage", revokeInvite);
