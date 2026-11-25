import { inviteTokenQuery } from "@/contracts/v1/management";
import { acceptInvite, viewInvite } from "@/server/modules/team/invites";
import { sessionRoute } from "@/server/public-api/session-route";

export const GET = sessionRoute(inviteTokenQuery, (principal, { token }) =>
  viewInvite(principal, token),
);
export const POST = sessionRoute(inviteTokenQuery, (principal, { token }) =>
  acceptInvite(principal, token),
);
