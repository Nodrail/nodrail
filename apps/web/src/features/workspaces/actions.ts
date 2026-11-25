"use server";

import { requirePrincipal } from "@/server/auth/current";
import { AppError } from "@/server/db/context";
import { createWorkspace } from "@/server/modules/workspaces";

export type CreateWorkspaceState =
  | { status: "idle" | "invalid" | "unavailable" }
  | { status: "created"; slug: string; workspaceId: string };

export async function createWorkspaceAction(
  _previous: CreateWorkspaceState,
  formData: FormData,
): Promise<CreateWorkspaceState> {
  const principal = await requirePrincipal();
  try {
    const created = await createWorkspace(principal, {
      name: formData.get("name"),
    });
    return { status: "created", ...created };
  } catch (error) {
    if (error instanceof AppError && error.code === "INVALID_INPUT")
      return { status: "invalid" };
    if (error instanceof AppError && error.code === "BUSY")
      return { status: "unavailable" };
    throw error;
  }
}
