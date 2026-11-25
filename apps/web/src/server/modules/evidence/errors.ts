import "server-only";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import {
  evidenceRejections,
  type EvidenceRejection,
} from "@/contracts/v1/evidence";

/** A submission refused for one stated reason; the HTTP status follows it. */
export class EvidenceError extends Error {
  readonly status: number;
  constructor(readonly code: EvidenceRejection) {
    super(code);
    this.status = evidenceRejections[code];
  }
}

/**
 * The API's error shape for an evidence refusal, or null for anything else,
 * which the shared handler answers.
 */
export function evidenceFailure(error: unknown) {
  if (!(error instanceof EvidenceError)) return null;
  return NextResponse.json(
    { error: { code: error.code, request_id: randomUUID() } },
    { status: error.status, headers: { "Cache-Control": "no-store" } },
  );
}
