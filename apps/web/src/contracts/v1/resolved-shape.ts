import type { z } from "zod";
import {
  ENUM_VALUE,
  LIMITS,
  PROPERTY_NAME,
  UNIT,
  isDate,
  resolvedShape as engineShape,
  type ResolvedProperty,
  type ResolvedShape,
} from "./shapes-engine";

/**
 * A resolved shape as the engine digests it (docs/contracts.md, "Digests
 * and the lock"): every field explicit, bounds filled in. What a publish or
 * a report sends is checked against this before its digest is recomputed,
 * so a stored revision is always bounded, typed JSON the engine can read.
 * The structure is the engine's own exported schema; the grammar's limits
 * it leaves to the compiler (names, values, dates, bounds, 64 properties,
 * depth 4) are checked here, since Cloud takes shapes no compiler made.
 */

/** Named properties and the deepest level, counted as the engine counts them. */
export function measureShape(properties: Record<string, ResolvedProperty>) {
  let named = 0;
  let deepest = 0;
  const walk = (property: ResolvedProperty, level: number) => {
    deepest = Math.max(deepest, level);
    if (property.type === "list") walk(property.of, level + 1);
    if (property.type === "object") visit(property.properties, level + 1);
  };
  const visit = (map: Record<string, ResolvedProperty>, level: number) => {
    for (const property of Object.values(map)) {
      named += 1;
      walk(property, level);
    }
  };
  visit(properties, 1);
  return { named, deepest };
}

const within = (value: number, max: number) =>
  Number.isInteger(value) && value >= 0 && value <= max;

/** What the grammar refuses in one property, apart from its children. */
function propertyProblem(property: ResolvedProperty): string | null {
  switch (property.type) {
    case "string":
      return within(property.min, LIMITS.stringMax) &&
        within(property.max, LIMITS.stringMax)
        ? null
        : "a string's bounds";
    case "list":
      return within(property.min, LIMITS.listMax) &&
        within(property.max, LIMITS.listMax)
        ? null
        : "a list's bounds";
    case "enum":
      return property.values.every((value) => ENUM_VALUE.test(value))
        ? null
        : "an enum value";
    case "integer":
    case "number":
      return property.unit === null || UNIT.test(property.unit)
        ? null
        : "a unit";
    case "date":
      return [property.min, property.max].every(
        (bound) => bound === null || isDate(bound),
      )
        ? null
        : "a YYYY-MM-DD date";
    default:
      return null;
  }
}

/** The first property name or value the grammar refuses, by path. */
function shapeProblem(
  properties: Record<string, ResolvedProperty>,
  prefix: string,
): string | null {
  for (const [name, property] of Object.entries(properties)) {
    const path = prefix ? `${prefix}.${name}` : name;
    if (!PROPERTY_NAME.test(name)) return `${path}: a property name`;
    const problem = propertyProblem(property);
    if (problem) return `${path}: ${problem}`;
    const inner = property.type === "list" ? property.of : property;
    const nested =
      inner.type === "object"
        ? shapeProblem(inner.properties, path)
        : property.type === "list"
          ? shapeProblem({ item: inner }, path)
          : null;
    if (nested) return nested;
  }
  return null;
}

/** A resolved shape within the grammar's limits: 64 properties, depth 4. */
export const resolvedShape = engineShape.superRefine((shape, context) => {
  const { named, deepest } = measureShape(shape.properties);
  if (named > LIMITS.properties)
    context.addIssue({ code: "custom", message: "too many properties" });
  if (deepest > LIMITS.depth)
    context.addIssue({ code: "custom", message: "nested too deep" });
  const problem = shapeProblem(shape.properties, "");
  if (problem) context.addIssue({ code: "custom", message: problem });
}) satisfies z.ZodType<ResolvedShape>;
