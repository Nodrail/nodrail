import { NextResponse, type NextRequest } from "next/server";
import { MAX_EVIDENCE_BODY_BYTES } from "@/contracts/v1/evidence";
import { answer } from "@/server/http/api";
import {
  EvidenceError,
  evidenceFailure,
} from "@/server/modules/evidence/errors";
import { ingestEvidence } from "@/server/modules/evidence/ingest";

/** The GitHub Actions OIDC token, as `Authorization: Bearer <jwt>`. */
function oidcToken(request: NextRequest) {
  const match = /^Bearer (\S+)$/.exec(
    request.headers.get("authorization") ?? "",
  );
  if (!match?.[1]) throw new EvidenceError("token-invalid");
  return match[1];
}

async function jsonBody(request: NextRequest): Promise<unknown> {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new EvidenceError("invalid-input");
  const text = await request.text();
  if (Buffer.byteLength(text) > MAX_EVIDENCE_BODY_BYTES)
    throw new EvidenceError("too-large");
  try {
    return JSON.parse(text);
  } catch {
    throw new EvidenceError("invalid-input");
  }
}

/**
 * Evidence from a CI job: authenticated by its GitHub Actions
 * OIDC token only, never a Nodrail token. A refusal names its reason; a
 * retry of the same body answers the event already stored.
 */
export async function POST(request: NextRequest) {
  try {
    const token = oidcToken(request);
    const stored = await ingestEvidence(token, await jsonBody(request));
    return NextResponse.json(stored, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return (
      evidenceFailure(error) ?? answer("Evidence", () => Promise.reject(error))
    );
  }
}
