import { NextResponse } from "next/server";
import { asNotifier } from "@/server/db/context";
import { describeError } from "@/server/log";

export const dynamic = "force-dynamic";

const answer = (status: "ok" | "unavailable", code: number) =>
  NextResponse.json(
    { status },
    { status: code, headers: { "Cache-Control": "no-store" } },
  );

/** Says whether the service can reach its database, and nothing else. */
export async function GET() {
  try {
    await asNotifier((manager) => manager.query("SELECT 1"));
    return answer("ok", 200);
  } catch (error) {
    console.error("Health check failed", describeError(error));
    return answer("unavailable", 503);
  }
}
