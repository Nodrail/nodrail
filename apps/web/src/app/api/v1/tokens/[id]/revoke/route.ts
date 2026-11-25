import { revokeApiToken } from "@/server/modules/api-tokens";
import { idAction } from "@/server/public-api/route";

export const POST = idAction("read", revokeApiToken, "session");
