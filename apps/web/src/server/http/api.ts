import "server-only";
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { describeError } from "@/server/log";
import { AppError } from "@/server/db/context";

/**
 * What the runtime API and the personal API share: bearer tokens only, JSON
 * bodies with a size limit, and one error shape with a request id.
 */
const privateHeaders = { "Cache-Control": "no-store" };

function failure(
  code: string,
  status: number,
  requestId: string,
  message?: string,
) {
  return NextResponse.json(
    { error: { code, request_id: requestId, ...(message ? { message } : {}) } },
    { status, headers: privateHeaders },
  );
}

export function bearerToken(request: NextRequest) {
  // A browser's session must never be mistaken for a token, or vice versa.
  if (request.headers.has("cookie")) throw new AppError("UNAUTHENTICATED");
  const match = /^Bearer (\S+)$/.exec(
    request.headers.get("authorization") ?? "",
  );
  if (!match?.[1]) throw new AppError("UNAUTHENTICATED");
  return match[1];
}

export async function readBody(
  request: NextRequest,
  maxBytes: number,
): Promise<unknown> {
  if (request.method === "GET" || request.method === "DELETE") return undefined;
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new AppError("INVALID_INPUT");
  const text = await request.text();
  if (Buffer.byteLength(text) > maxBytes) throw new AppError("INVALID_INPUT");
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError("INVALID_INPUT");
  }
}

/** Runs one API call and answers in the shared shape, whatever happens. */
export async function answer(
  label: string,
  run: () => Promise<unknown>,
): Promise<NextResponse> {
  const requestId = randomUUID();
  try {
    const body = await run();
    return body instanceof NextResponse
      ? body
      : NextResponse.json(body, { headers: privateHeaders });
  } catch (error) {
    if (error instanceof AppError) {
      // Not a fault, but an integration that keeps one run key too long.
      if (error.code === "RUN_TOO_LONG")
        console.info("Run too long to decide", requestId);
      return failure(error.code, error.status, requestId, error.detail);
    }
    console.error(`${label} request failed`, requestId, describeError(error));
    return failure("UNAVAILABLE", 503, requestId);
  }
}
