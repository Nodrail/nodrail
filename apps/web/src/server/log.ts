type LoggedError = {
  name: string;
  code?: unknown;
  message?: string;
  stack?: string | undefined;
  cause?: LoggedError;
};

/**
 * What is safe to log about a failure. Database errors carry their query and
 * parameters and mail errors quote addresses, so those keep only their code.
 */
export function describeError(error: unknown): LoggedError {
  if (!(error instanceof Error)) return { name: "Unknown" };
  const { code, driverError, detail, cause } = error as Error & {
    code?: unknown;
    driverError?: { code?: unknown };
    /** Where Stripe puts the failure behind a connection error. */
    detail?: unknown;
  };
  const operational = driverError?.code ?? code;
  if (operational !== undefined) return { name: error.name, code: operational };
  const underlying = detail ?? cause;
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
    ...(underlying instanceof Error
      ? { cause: describeError(underlying) }
      : {}),
  };
}

/** A URL fit for logs: no query string, and no token in an invite or sign-in path. */
export function safePath(path: string) {
  const [bare = ""] = path.split("?");
  return bare.replace(/^(\/invite\/).+$/, "$1[token]");
}
