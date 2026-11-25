import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { GET } from "@/app/api/v1/openapi.json/route";
import { openApiDocument } from "@/server/public-api/openapi";

const root = fileURLToPath(new URL("../src/app/api/v1/", import.meta.url));

function routeOperations() {
  const methods =
    /^export (?:const |(?:async )?function )(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/gm;
  return readdirSync(root, { recursive: true, withFileTypes: true }).flatMap(
    (entry) => {
      if (!entry.isFile() || entry.name !== "route.ts") return [];
      const path =
        "/" + relative(root, entry.parentPath).replace(/\[([^\]]+)\]/g, "{$1}");
      const source = readFileSync(join(entry.parentPath, entry.name), "utf8");
      return [...source.matchAll(methods)].map(
        ([, method]) => `${method} ${path}`,
      );
    },
  );
}

test("the OpenAPI endpoint describes all v1 routes and only those routes", async () => {
  const response = GET();
  expect(response.status).toBe(200);
  const document = openApiDocument();
  expect(await response.json()).toEqual(document);
  expect(document.openapi).toBe("3.1.0");
  const operations = Object.entries(document.paths).flatMap(([path, entry]) =>
    Object.keys(entry).map((method) => `${method.toUpperCase()} ${path}`),
  );
  expect(operations.sort()).toEqual(routeOperations().sort());
  expect(
    new Set(
      Object.values(document.paths)
        .flatMap(Object.values)
        .map((entry) => entry.operationId),
    ).size,
  ).toBe(operations.length);
});

test("local schema references resolve within the OpenAPI document", () => {
  const document = openApiDocument();
  const refs: string[] = [];
  JSON.stringify(document, (key, value: unknown) => {
    if (key === "$ref" && typeof value === "string") refs.push(value);
    return value;
  });
  expect(refs.length).toBeGreaterThan(0);
  for (const ref of refs) {
    const pointer = ref
      .slice(2)
      .split("/")
      .map((key) => key.replaceAll("~1", "/").replaceAll("~0", "~"));
    const found = pointer.reduce<unknown>(
      (node, key) =>
        node && typeof node === "object"
          ? (node as Record<string, unknown>)[key]
          : undefined,
      document,
    );
    expect(found, ref).toBeDefined();
  }
});
