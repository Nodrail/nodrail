import type { NextRequest } from "next/server";
import { answer } from "@/server/http/api";
import { csrfToken, currentApiSession } from "@/server/public-api/session";

export async function GET(request: NextRequest) {
  let cookie: ReturnType<typeof csrfToken>["cookie"] | undefined;
  const response = await answer("Management API", async () => {
    await currentApiSession(request);
    const issued = csrfToken(request);
    cookie = issued.cookie;
    return { token: issued.token };
  });
  if (response.ok && cookie) response.cookies.set(cookie);
  return response;
}
