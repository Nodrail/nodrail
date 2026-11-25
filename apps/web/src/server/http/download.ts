import "server-only";
import { NextResponse } from "next/server";
import type { WorkspaceContext } from "@/server/db/context";
import { AppError, readWorkspace, withWorkspace } from "@/server/db/context";
import { requirePrincipal } from "@/server/auth/current";
import { loadWorkspaceView } from "@/features/shell/load-view";

/** A file with extra headers, and what to record once it has been read. */
export type DownloadBody = {
  text: string;
  headers?: Record<string, string>;
  /** Written in its own transaction; the file is sent only if it succeeds. */
  record?: (context: WorkspaceContext) => Promise<unknown>;
};

/**
 * A file only people with access to this workspace can download. The body is
 * read as the person's screens are, so it holds only what they may see.
 */
export async function workspaceDownload(
  workspace: string,
  file: {
    type: string;
    name: (slug: string) => string;
    body: (context: WorkspaceContext) => Promise<string | DownloadBody>;
  },
) {
  const principal = await requirePrincipal();
  const view = await loadWorkspaceView(workspace);
  try {
    const read = await readWorkspace(principal, view.id, file.body);
    const body = typeof read === "string" ? { text: read } : read;
    if (body.record) await withWorkspace(principal, view.id, body.record);
    return new NextResponse(body.text, {
      headers: {
        ...body.headers,
        "content-type": file.type,
        "content-disposition": `attachment; filename="${file.name(view.slug)}"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof AppError)
      return NextResponse.json(
        // The same safe message the API sends (`AppError.detail`), if any.
        {
          error: {
            code: error.code,
            ...(error.detail ? { message: error.detail } : {}),
          },
        },
        { status: error.status },
      );
    throw error;
  }
}
