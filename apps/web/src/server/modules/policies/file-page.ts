import "server-only";
import { AppError, type WorkspaceContext } from "@/server/db/context";
import { readPolicyFile } from "./rule-files";

/**
 * The live rules as a file for a page (Edit as YAML, Copy policies), or null
 * when Cloud can't show them as one (a version 4 policy): the page then says
 * why, with `VERSION_NOT_RENDERABLE_MESSAGE`, instead of failing.
 */
export async function policyFileForPage(
  context: WorkspaceContext,
  environmentSlug: string,
) {
  try {
    return await readPolicyFile(context, environmentSlug);
  } catch (error) {
    if (error instanceof AppError && error.code === "VERSION_NOT_RENDERABLE")
      return null;
    throw error;
  }
}
