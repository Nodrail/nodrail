import { z } from "zod";
import { existingOperations } from "./existing";
import { managementOperations } from "./management";
import { operation, type Auth, type Operation } from "./operation";
import { runtimeOperations } from "./runtime";

const jsonSchema = (schema: z.ZodType, io: "input" | "output" = "input") => {
  const { $schema: _dialect, ...body } = z.toJSONSchema(schema, {
    target: "draft-2020-12",
    io,
    // Opaque JSON and application-specific refinements still run at runtime.
    unrepresentable: "any",
  });
  return body;
};

const pointerKey = (key: string) =>
  key.replaceAll("~", "~0").replaceAll("/", "~1");

/** Zod's relative references start at the schema root, which OpenAPI embeds. */
function atPointer(schema: ReturnType<typeof jsonSchema>, pointer: string) {
  return JSON.parse(
    JSON.stringify(schema, (key, value: unknown) =>
      key === "$ref" && typeof value === "string" && value.startsWith("#")
        ? pointer + value.slice(1)
        : value,
    ),
  ) as ReturnType<typeof jsonSchema>;
}

function jsonContent(schema: z.ZodType, at: string, io?: "input" | "output") {
  return {
    "application/json": {
      schema: atPointer(
        jsonSchema(schema, io),
        `${at}/content/application~1json/schema`,
      ),
    },
  };
}

const getSecurity = (auth: Auth) => {
  if (auth === "public") return [];
  if (auth === "github") return [{ githubActions: [] }];
  if (typeof auth === "string") return [{ consoleSession: [] }];
  if ("runtime" in auth) return [{ runtimeCredential: [] }];
  const token = { personalToken: [] };
  return auth.bearerOnly ? [token] : [token, { consoleSession: [] }];
};

const hasWorkspaceSession = (auth: Auth) =>
  auth === "workspaceSession" ||
  (typeof auth === "object" && "management" in auth && !auth.bearerOnly);

const acceptsSession = (auth: Auth) =>
  auth === "session" || hasWorkspaceSession(auth);

function parameters(entry: Operation) {
  const query = entry.query && resolvableQuery(entry.query);
  const supportsSession = hasWorkspaceSession(entry.auth);
  return [
    ...[...entry.path.matchAll(/\{([^}]+)\}/g)].map(([, name]) => ({
      name,
      in: "path",
      required: true,
      schema: name === "id" ? jsonSchema(z.uuid()) : { type: "string" },
    })),
    ...Object.entries(query?.properties ?? {}).map(([name, schema]) => ({
      name,
      in: "query",
      required: query?.required?.includes(name) ?? false,
      schema,
    })),
    ...(supportsSession
      ? [
          {
            name: "workspace",
            in: "query",
            required: entry.auth === "workspaceSession",
            description:
              "Workspace slug. Required for a console session and omitted for a bearer token.",
            schema: { type: "string" },
          },
        ]
      : []),
    ...Object.entries(entry.headers ?? {}).map(([name, schema]) => ({
      name,
      in: "header",
      required: true,
      schema: jsonSchema(schema),
    })),
    ...(entry.method !== "get" && acceptsSession(entry.auth)
      ? [
          {
            name: "X-Nodrail-CSRF",
            in: "header",
            required: typeof entry.auth === "string",
            description:
              "Required with a console session. Get the token from GET /session/csrf.",
            schema: { type: "string" },
          },
        ]
      : []),
  ];
}

function resolvableQuery(schema: z.ZodType) {
  return jsonSchema(schema) as {
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

const error = z.object({
  error: z.object({
    code: z.string(),
    request_id: z.uuid(),
    message: z.string().optional(),
  }),
});
const protobuf = {
  "application/x-protobuf": { schema: { type: "string", format: "binary" } },
};

function describe(entry: Operation) {
  const { auth, body, result, method, path } = entry;
  const at = `#/paths/${pointerKey(path)}/${method}`;
  return {
    operationId: `${method}${path
      .replace(/[{}]/g, "")
      .split(/[/.-]/)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join("")}`,
    summary: entry.summary,
    security: getSecurity(auth),
    parameters: parameters(entry),
    ...(typeof auth === "object"
      ? {
          "x-nodrail-scope": "runtime" in auth ? auth.runtime : auth.management,
        }
      : {}),
    ...(body
      ? {
          requestBody: {
            required: true,
            content: {
              ...jsonContent(body, `${at}/requestBody`),
              ...(entry.protobuf ? protobuf : {}),
            },
          },
        }
      : {}),
    responses: {
      "200": {
        description: "Success",
        content: {
          ...jsonContent(
            result ?? z.unknown(),
            `${at}/responses/200`,
            "output",
          ),
          ...(entry.protobuf ? protobuf : {}),
        },
      },
      ...(auth === "public"
        ? {}
        : {
            default: {
              description: "Request error",
              content: jsonContent(error, `${at}/responses/default`, "output"),
            },
          }),
    },
  };
}

export function openApiDocument() {
  const paths: Record<string, Record<string, ReturnType<typeof describe>>> = {};
  const entries = [
    ...existingOperations,
    ...managementOperations,
    ...runtimeOperations,
    operation("get", "/openapi.json", "Read this OpenAPI document", {
      auth: "public",
    }),
  ];
  for (const entry of entries) {
    const methods = (paths[entry.path] ??= {});
    if (methods[entry.method])
      throw new Error(
        `Duplicate OpenAPI operation: ${entry.method} ${entry.path}`,
      );
    methods[entry.method] = describe(entry);
  }
  return {
    openapi: "3.1.0",
    info: { title: "Nodrail Control Plane API", version: "1.0.0" },
    servers: [{ url: "/api/v1" }],
    paths,
    components: {
      securitySchemes: {
        personalToken: { type: "http", scheme: "bearer", bearerFormat: "ndp_" },
        runtimeCredential: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "ndr_",
        },
        githubActions: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
        consoleSession: {
          type: "apiKey",
          in: "cookie",
          name: "session",
          description:
            "Use the session cookie set by console login. The cookie name is chosen by the login provider. Writes require same-origin Origin and a CSRF token.",
        },
      },
    },
  };
}
