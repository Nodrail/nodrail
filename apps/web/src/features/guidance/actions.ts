"use server";

import { unstable_rethrow } from "next/navigation";
import type { GuidanceMark } from "@/contracts/v1/guidance";
import { requirePrincipal } from "@/server/auth/current";
import { withUser } from "@/server/db/context";
import { describeError } from "@/server/log";
import { markGuidance } from "@/server/modules/guidance";

/**
 * Remembers that this person has seen a tour, a list or an entry. Guidance is
 * never worth an error message: the screen has already moved on, and at worst
 * the same help shows once more.
 */
export async function markGuidanceAction(
  input: GuidanceMark,
): Promise<{ status: "ok" | "error" }> {
  try {
    const principal = await requirePrincipal();
    await withUser(principal, (context) => markGuidance(context, input));
    return { status: "ok" };
  } catch (error) {
    unstable_rethrow(error);
    console.error("Guidance not recorded", describeError(error));
    return { status: "error" };
  }
}
