import { decodeSpans } from "@nodrail/sdk";
import { NextResponse, type NextRequest } from "next/server";
import { MAX_OTLP_BODY_BYTES } from "@/contracts/v1/inventory";
import { AppError } from "@/server/db/context";
import { withPersonalToken } from "@/server/db/token-context";
import { answer, bearerToken } from "@/server/http/api";
import {
  ingestReports,
  type IngestResult,
} from "@/server/modules/reporting/ingest";
import { defaultEnvironment } from "@/server/public-api/route";

const environmentSlug = /^[a-z0-9][a-z0-9-]{0,62}$/;

async function readExport(request: NextRequest) {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_OTLP_BODY_BYTES) throw new AppError("INVALID_INPUT");
  const body = new Uint8Array(await request.arrayBuffer());
  if (body.length > MAX_OTLP_BODY_BYTES) throw new AppError("INVALID_INPUT");
  try {
    return decodeSpans(body, request.headers.get("content-type") ?? "");
  } catch {
    throw new AppError("INVALID_INPUT");
  }
}

const varint = (value: number) => {
  const bytes: number[] = [];
  do {
    bytes.push((value & 0x7f) | (value > 0x7f ? 0x80 : 0));
    value = Math.floor(value / 128);
  } while (value > 0);
  return bytes;
};

/**
 * ExportTraceServiceResponse, as the request was sent: partial success
 * { rejected_spans 1; error_message 2 } when some spans weren't kept.
 */
function exportAnswer(result: IngestResult, protobuf: boolean) {
  const message = "spans the reporting contract doesn't read were not kept";
  if (!protobuf)
    return NextResponse.json(
      result.rejected > 0
        ? {
            partialSuccess: {
              rejectedSpans: String(result.rejected),
              errorMessage: message,
            },
          }
        : {},
    );
  const text = [...new TextEncoder().encode(message)];
  const partial =
    result.rejected > 0
      ? [
          0x08,
          ...varint(result.rejected),
          0x12,
          ...varint(text.length),
          ...text,
        ]
      : [];
  const body =
    partial.length > 0
      ? Uint8Array.from([0x0a, ...varint(partial.length), ...partial])
      : new Uint8Array();
  return new NextResponse(body, {
    headers: {
      "content-type": "application/x-protobuf",
      "cache-control": "no-store",
    },
  });
}

/**
 * OTLP/HTTP traces, for the team's inventory: point a project's
 * `telemetry:` here with a reporting token (`inventory:write`). Each
 * `nodrail.observation` span becomes the token's person's report;
 * `?environment=<slug>` picks the environment, or the default one.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  let result: IngestResult | undefined;
  const failed = await answer("OTLP", async () => {
    const token = bearerToken(request);
    const environment = request.nextUrl.searchParams.get("environment");
    if (environment !== null && !environmentSlug.test(environment))
      throw new AppError("INVALID_INPUT");
    // The token first: a caller without one learns nothing about the body.
    result = await withPersonalToken(
      token,
      { scope: "inventory:write", access: "write" },
      async (context) =>
        ingestReports(
          context,
          environment ?? (await defaultEnvironment(context)),
          await readExport(request),
        ),
    );
    return {};
  });
  if (result === undefined) return failed;
  return exportAnswer(
    result,
    (request.headers.get("content-type") ?? "").startsWith(
      "application/x-protobuf",
    ),
  );
}
