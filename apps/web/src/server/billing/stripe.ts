import "server-only";
import Stripe from "stripe";
import { deploymentMode } from "@/server/deployment";

export function billingConfig() {
  if (deploymentMode() !== "cloud") return null;
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const proPriceId = process.env.STRIPE_PRICE_PRO;
  if (!secretKey || !webhookSecret || !proPriceId) return null;
  // Earlier Pro prices that subscribers may still be on. New checkouts only
  // sell STRIPE_PRICE_PRO, but a webhook for an older price must not demote.
  const recognized = (process.env.STRIPE_PRICE_PRO_RECOGNIZED ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  return {
    secretKey,
    webhookSecret,
    proPriceId,
    proPriceIds: new Set([proPriceId, ...recognized]),
  };
}

const loopback = new Set(["127.0.0.1", "localhost"]);

/** Only ever a stand-in on this machine, never somewhere a real key could go. */
function apiTarget() {
  const base = process.env.STRIPE_API_BASE;
  if (!base) return {};
  const url = new URL(base);
  if (!loopback.has(url.hostname))
    throw new Error("STRIPE_API_BASE must point at this machine");
  return {
    host: url.hostname,
    port: Number(url.port),
    protocol: "http" as const,
  };
}

export function stripeClient() {
  const config = billingConfig();
  if (!config) throw new Error("Payments are not configured");
  return new Stripe(config.secretKey, {
    ...apiTarget(),
    timeout: 10_000,
    maxNetworkRetries: 1,
  });
}
