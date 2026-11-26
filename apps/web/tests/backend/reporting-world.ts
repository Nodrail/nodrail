// Reporting over OTLP, as an installation sends it: shared by the
// inventory and reporting tests.
import { NextRequest } from "next/server";
import { withWorkspace } from "@/server/db/context";
import { createApiToken } from "@/server/modules/api-tokens";
import * as traces from "@/app/api/v1/otlp/v1/traces/route";
import {
  encodeSpans,
  type SpanRecord,
} from "../../../../packages/policy-engine/src/otlp";
import type { Person, TestWorkspace } from "./world";

export type { SpanRecord };

export const MACHINE = "a".repeat(32);
export const PROJECT_ID = "5c2a1f3e-7b8d-4c9a-8e1f-2a3b4c5d6e7f";
export const REVISION = "b".repeat(64);

export function observation(
  attributes: Record<string, string> = {},
  at = Date.now(),
): SpanRecord {
  const nanos = (BigInt(at) * 1_000_000n).toString();
  return {
    traceId: "0af7651916cd43dd8448eb211c80319c",
    spanId: "b7ad6b7169203331",
    name: "nodrail.observation",
    start: nanos,
    end: nanos,
    attributes: {
      "nodrail.machine": MACHINE,
      "nodrail.host": "claude-code",
      "nodrail.agent": "lead",
      "nodrail.activation": "configured",
      "nodrail.in_step": "true",
      "nodrail.drift": "0",
      "nodrail.workspace.revision": REVISION,
      "nodrail.workspace.locked": REVISION,
      "nodrail.unmanaged.skill": "2",
      ...attributes,
    },
  };
}

let next = 0;
/** A span with its own ids, at a time, by name and attributes. */
export function span(
  name: string,
  attributes: Record<string, string>,
  at = Date.now(),
): SpanRecord {
  next += 1;
  const nanos = (BigInt(at) * 1_000_000n).toString();
  // Unique across test files running side by side on one database.
  const id = `${process.pid.toString(16)}${next.toString(16).padStart(8, "0")}`;
  return {
    traceId: id.padStart(32, "0"),
    spanId: id.padStart(16, "0").slice(-16),
    name,
    start: nanos,
    end: nanos,
    attributes,
  };
}

export async function send(
  token: string,
  spans: SpanRecord[],
  options: {
    protocol?: "otlp-http/protobuf" | "otlp-http/json";
    environment?: string;
    project?: string;
    projectId?: string;
    /** The resource's `nodrail.schema`; 2 unless said. */
    schema?: string;
  } = {},
) {
  const { body, contentType } = encodeSpans(
    spans,
    {
      "service.name": "nodrail",
      "nodrail.schema": options.schema ?? "2",
      "nodrail.project": options.project ?? "desk",
      ...(options.projectId ? { "nodrail.project.id": options.projectId } : {}),
    },
    options.protocol ?? "otlp-http/protobuf",
  );
  const url = new URL("http://localhost/api/v1/otlp/v1/traces");
  if (options.environment)
    url.searchParams.set("environment", options.environment);
  const response = await traces.POST(
    new NextRequest(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": contentType,
      },
      body,
    }),
  );
  const bytes = new Uint8Array(await response.arrayBuffer());
  return {
    status: response.status,
    type: response.headers.get("content-type"),
    bytes,
  };
}

/** A JSON body POSTed to a route with a bearer token, answered as JSON. */
export async function postJson(
  route: (
    request: NextRequest,
    segment: { params: Promise<object> },
  ) => Promise<Response>,
  path: string,
  token: string,
  body: unknown,
  headers?: Record<string, string>,
) {
  const response = await route(
    new NextRequest(`http://localhost/api/v1/${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({}) },
  );
  return { status: response.status, json: (await response.json()) as any };
}

export const json = (bytes: Uint8Array) =>
  JSON.parse(new TextDecoder().decode(bytes)) as Record<string, any>;

export async function reportingToken(w: TestWorkspace, person: Person) {
  const { secret } = await withWorkspace(person, w.id, (context) =>
    createApiToken(context, {
      name: "observe",
      scopes: ["inventory:write"],
      expiresInDays: 90,
    }),
  );
  return secret;
}
