/** A query value as one string; repeated or missing values become undefined. */
export const firstParam = (value: string | string[] | undefined) =>
  typeof value === "string" && value ? value : undefined;
