import "server-only";
import { revalidatePath } from "next/cache";
import { notFound, redirect, unstable_rethrow } from "next/navigation";
import { cache } from "react";
import type { ActionResult } from "@/components/app/action-result";
import { requirePrincipal } from "@/server/auth/current";
import { describeError } from "@/server/log";
import {
  AppError,
  decodeCursor,
  readWorkspace,
  withWorkspace,
  type ErrorCode,
  type WorkspaceContext,
} from "@/server/db/context";
import type { WorkspaceViewDto } from "@/contracts/v1/workspaces";
import { getWorkspaceView } from "@/server/modules/workspaces";
import { appRoute } from "@/lib/product-path";

function handlePageError(error: unknown): never {
  if (error instanceof AppError) {
    if (error.code === "NOT_FOUND" || error.code === "INVALID_INPUT")
      notFound();
    if (error.code === "UNAUTHENTICATED") redirect("/login");
  }
  throw error;
}

/** Membership and role are checked here on every request, not in the menu. */
export const loadWorkspaceView = cache(async (slug: string) => {
  const principal = await requirePrincipal();
  try {
    return await getWorkspaceView(principal, slug);
  } catch (error) {
    handlePageError(error);
  }
});

/** Where the workspace opens: its default environment, else the first. */
export function defaultEnvironment(
  view: Pick<WorkspaceViewDto, "environments" | "defaultEnvironmentId">,
) {
  return (
    view.environments.find((item) => item.id === view.defaultEnvironmentId) ??
    view.environments[0]
  );
}

/** Server page data, limited by the database to what this person may see. */
export async function readForPage<T>(
  slug: string,
  run: (context: WorkspaceContext) => Promise<T>,
): Promise<T> {
  const principal = await requirePrincipal();
  const view = await loadWorkspaceView(slug);
  try {
    return await readWorkspace(principal, view.id, run);
  } catch (error) {
    handlePageError(error);
  }
}

/**
 * Screen data the browser asks for after the page has loaded, such as a panel
 * opened over a list: the page's own checks, with null for what this person
 * cannot see or what does not exist, so both look the same.
 */
export async function readForClient<T>(
  slug: string,
  run: (context: WorkspaceContext) => Promise<T>,
): Promise<T | null> {
  const principal = await requirePrincipal();
  const view = await loadWorkspaceView(slug);
  try {
    return await readWorkspace(principal, view.id, run);
  } catch (error) {
    if (
      error instanceof AppError &&
      (error.code === "NOT_FOUND" || error.code === "INVALID_INPUT")
    )
      return null;
    handlePageError(error);
  }
}

/**
 * A list page's cursor, checked before the page streams: one that cannot be
 * read is a page that does not exist, and must answer 404, not a streamed one.
 */
export function readableCursor(cursor: string | undefined) {
  try {
    decodeCursor(cursor);
  } catch (error) {
    handlePageError(error);
  }
  return cursor;
}

const defaultMessages: Partial<Record<ErrorCode, string>> = {
  FORBIDDEN: "You don't have permission to do that.",
  NOT_FOUND: "That no longer exists.",
  INSUFFICIENT_SCOPE: "This credential lacks the required permission.",
  INVALID_INPUT: "Check the details and try again.",
  ALREADY_EXISTS: "That already exists.",
  BUSY: "Someone else is making a change. Try again in a moment.",
};

/**
 * Every product change goes through here: session, membership and capability
 * are verified again on the server, and expected errors become messages.
 */
export async function runWorkspaceAction<T>(
  slug: string,
  run: (context: WorkspaceContext) => Promise<T>,
  messages: Partial<Record<ErrorCode, string>> = {},
): Promise<
  { status: "ok"; value: T } | Extract<ActionResult, { status: "error" }>
> {
  try {
    const principal = await requirePrincipal();
    const view = await loadWorkspaceView(slug);
    const value = await withWorkspace(principal, view.id, run);
    revalidatePath(appRoute(slug), "layout");
    return { status: "ok", value };
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof AppError && error.code === "UNAUTHENTICATED")
      redirect("/login");
    if (!(error instanceof AppError))
      console.error("Workspace action failed", describeError(error));
    return {
      status: "error",
      message:
        (error instanceof AppError &&
          (error.detail ??
            messages[error.code] ??
            defaultMessages[error.code])) ||
        "Something went wrong. Please try again.",
    };
  }
}
