import { NextResponse, type NextRequest } from "next/server";
import { receiveStripeWebhook } from "@/server/modules/billing";

export async function POST(request: NextRequest) {
  const status = await receiveStripeWebhook(
    await request.text(),
    request.headers.get("stripe-signature"),
  );
  return NextResponse.json({ received: status === 200 }, { status });
}
