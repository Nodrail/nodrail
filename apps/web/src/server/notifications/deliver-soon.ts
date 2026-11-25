import "server-only";
import { after } from "next/server";
import { describeError } from "@/server/log";
import { deliverNotifications } from "./delivery";

function logDeliveryFailure(error: unknown) {
  console.error("Notification delivery failed", describeError(error));
}

/**
 * Runs after the response, once this request's transaction has committed.
 * Whatever it does, the answer already sent is decided.
 */
export const deliverSoon = () =>
  after(() => deliverNotifications().catch(logDeliveryFailure));
