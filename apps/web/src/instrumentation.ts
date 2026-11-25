import { describeError, safePath } from "@/server/log";

/** One structured line per failed request, safe to send to any log service. */
export function onRequestError(
  error: unknown,
  request: { path: string; method: string },
  context: { routeType: string },
) {
  const digest =
    typeof error === "object" && error !== null && "digest" in error
      ? String(error.digest)
      : undefined;
  console.error(
    JSON.stringify({
      event: "request_failed",
      digest,
      method: request.method,
      path: safePath(request.path),
      route: context.routeType,
      ...describeError(error),
    }),
  );
}

// Validate supplied database configuration before the Node server handles traffic.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { databaseConnection } = await import("@/server/db/connection-options");
  for (const url of [process.env.DATABASE_URL, process.env.AUTH_DATABASE_URL])
    if (url) databaseConnection(url);
}
