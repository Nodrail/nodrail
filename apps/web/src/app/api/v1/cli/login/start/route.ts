import type { NextRequest } from "next/server";
import { cliStart } from "@/contracts/v1/cli-login";
import { startCliLogin } from "@/server/auth/cli-login";
import { allowAttempt } from "@/server/auth/rate-limit";
import { clientSource } from "@/server/auth/source";
import { AppError, parseInput } from "@/server/db/context";
import { answer, readBody } from "@/server/http/api";

export function POST(request: NextRequest) {
  return answer("CLI login start", async () => {
    const input = parseInput(cliStart, await readBody(request, 4096));
    const source = clientSource(request.headers);
    if (!source || !(await allowAttempt("cli", source, input.challenge)))
      throw new AppError("RATE_LIMITED");
    await startCliLogin(input.origin, input.challenge);
    return { ok: true };
  });
}
