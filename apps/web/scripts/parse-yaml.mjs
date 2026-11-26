import { parseDocument } from "yaml";

export function yamlObject(text) {
  const document = parseDocument(text);
  if (document.errors.length || document.warnings.length)
    throw new Error("Invalid YAML");
  return document.toJS({ maxAliasCount: 0 });
}

export const isMap = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
