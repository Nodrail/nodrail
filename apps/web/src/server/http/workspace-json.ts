import "server-only";
import { NextResponse } from "next/server";
import { getPrincipal } from "@/server/auth/current";
import {
  AppError,
  readWorkspace,
  type WorkspaceContext,
} from "@/server/db/context";
import { getWorkspaceView } from "@/server/modules/workspaces";

const failure = (code: string, status: number) =>
  NextResponse.json({ error: { code } }, { status });

/**
 * A small JSON read for a page to poll, such as the side menu's count. Only
 * a signed-in member can read it, and it reads as their screens do, so it
 * holds only what they may see. Never cached.
 */
export async function workspaceJson<T>(
  workspace: string,
  read: (context: WorkspaceContext) => Promise<T>,
) {
  const principal = await getPrincipal();
  if (!principal) return failure("UNAUTHENTICATED", 401);
  try {
    const view = await getWorkspaceView(principal, workspace);
    const body = await readWorkspace(principal, view.id, read);
    return NextResponse.json(body, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    if (error instanceof AppError) return failure(error.code, error.status);
    throw error;
  }
}
