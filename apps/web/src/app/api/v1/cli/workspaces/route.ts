import type { NextRequest } from "next/server";
import { resolveCliSession } from "@/server/auth/cli-login";
import { AppError } from "@/server/db/context";
import { answer, bearerToken } from "@/server/http/api";
import { listMyWorkspaces } from "@/server/modules/workspaces";
import { page } from "@/server/public-api/wire";

export function GET(request: NextRequest) {
  return answer("CLI workspaces", async () => {
    const principal = await resolveCliSession(bearerToken(request));
    if (!principal) throw new AppError("UNAUTHENTICATED");
    return page(await listMyWorkspaces(principal));
  });
}
