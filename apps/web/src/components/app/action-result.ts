/** What every product form and confirmation gets back from the server. */
export type ActionResult<T = undefined> =
  | { status: "idle" }
  | { status: "ok"; message?: string; data?: T }
  | { status: "error"; message: string };

export const idleResult = { status: "idle" } as const;
