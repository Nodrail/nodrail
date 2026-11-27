import type { NextRequest } from "next/server";
import { revokeCliSession } from "@/server/auth/cli-login";
import { AppError } from "@/server/db/context";
import { answer, bearerToken } from "@/server/http/api";

export function POST(request: NextRequest) {
  return answer("CLI logout", async () => {
    const token = bearerToken(request);
    if (!/^ndc_[A-Za-z0-9_-]{43}$/.test(token))
      throw new AppError("UNAUTHENTICATED");
    await revokeCliSession(token);
    return { ok: true };
  });
}
