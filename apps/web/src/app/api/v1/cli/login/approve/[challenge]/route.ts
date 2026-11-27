import { NextResponse, type NextRequest } from "next/server";
import { challengeSchema } from "@/contracts/v1/cli-login";
import { appOrigin } from "@/server/app-origin";
import { approveCliLogin, waitingCliLogin } from "@/server/auth/cli-login";
import { getPrincipal } from "@/server/auth/current";
import { AppError, parseInput } from "@/server/db/context";
import { answer } from "@/server/http/api";

type Segment = { params: Promise<{ challenge: string }> };

function html(body: string) {
  return new NextResponse(
    `<!doctype html><html lang="en"><meta charset="utf-8"><title>Nodrail CLI sign-in</title><main>${body}</main></html>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy":
          "default-src 'none'; form-action 'self'; frame-ancestors 'none'",
      },
    },
  );
}

export function GET(_request: NextRequest, { params }: Segment) {
  return answer("CLI login browser", async () => {
    const challenge = parseInput(challengeSchema, (await params).challenge);
    if (!(await waitingCliLogin(challenge)))
      return html("<h1>Start a new CLI login</h1>");
    if (!(await getPrincipal())) {
      const login = new URL("/login", appOrigin());
      login.searchParams.set("next", `/api/v1/cli/login/approve/${challenge}`);
      return NextResponse.redirect(login);
    }
    return html(`<h1>Sign in to the Nodrail CLI</h1>
      <p>Confirm only if your terminal shows this code <strong>${challenge.slice(0, 8)}</strong>.</p>
      <form method="post"><button type="submit">Confirm CLI sign-in</button></form>`);
  });
}

export function POST(request: NextRequest, { params }: Segment) {
  return answer("CLI login browser", async () => {
    if (request.headers.get("origin") !== appOrigin())
      throw new AppError("FORBIDDEN");
    const principal = await getPrincipal();
    if (!principal) throw new AppError("UNAUTHENTICATED");
    await approveCliLogin(
      parseInput(challengeSchema, (await params).challenge),
      principal,
    );
    return html(
      "<h1>CLI sign-in confirmed</h1><p>Return to your terminal.</p>",
    );
  });
}
