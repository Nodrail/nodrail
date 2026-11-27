import type { NextRequest } from "next/server";
import { exchangeCliLogin } from "@/server/auth/cli-login";
import { answer, readBody } from "@/server/http/api";

export function POST(request: NextRequest) {
  return answer("CLI login exchange", async () =>
    exchangeCliLogin(await readBody(request, 4096)),
  );
}
