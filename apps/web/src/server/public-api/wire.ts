/**
 * The personal API answers in snake_case, like the runtime API, from the same
 * read models the screens use. What an agent or integration sent is passed
 * through untouched: its keys are its own, not ours to rename.
 */
const passedThrough = new Set([
  "parameters",
  "details",
  "params_safe",
  "details_safe",
  "payload_safe",
]);

/** Screen hints about this person's other options, not part of the API. */
const screenOnly = new Set(["canManageRules", "canManage"]);

const snake = (key: string) =>
  key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

export function toWire(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(toWire);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !screenOnly.has(key))
      .map(([key, field]) => [
        snake(key),
        passedThrough.has(key) ? field : toWire(field),
      ]),
  );
}

/** A page of a list, as every list in the API answers. */
export const page = <T>(items: T[], nextCursor: string | null = null) => ({
  items,
  nextCursor,
});
