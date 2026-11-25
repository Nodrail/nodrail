// Run after adding Stripe test keys, to confirm they are usable before relying on them.
import Stripe from "stripe";

const {
  STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET,
  STRIPE_PRICE_PRO,
  STRIPE_API_BASE,
} = process.env;

function stop(message) {
  console.error(`Stripe check failed: ${message}`);
  process.exit(1);
}

if (!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET || !STRIPE_PRICE_PRO)
  stop("set STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET and STRIPE_PRICE_PRO");
if (!STRIPE_SECRET_KEY.startsWith("sk_test_"))
  stop("only test keys are accepted here");
if (!STRIPE_WEBHOOK_SECRET.startsWith("whsec_"))
  stop("the webhook secret should start with whsec_");

const target = STRIPE_API_BASE ? new URL(STRIPE_API_BASE) : null;
const stripe = new Stripe(
  STRIPE_SECRET_KEY,
  target
    ? { host: target.hostname, port: Number(target.port), protocol: "http" }
    : {},
);

const price = await stripe.prices
  .retrieve(STRIPE_PRICE_PRO)
  .catch((error) => stop(`could not read the price: ${error.message}`));
if (!price.active) stop("the price is archived");
if (!price.recurring) stop("the price must be recurring");
// The app shows the approved offer; the price charged has to be the same.
if (price.currency !== "usd" || price.unit_amount !== 2900)
  stop(`the price is ${price.unit_amount} ${price.currency}, not 2900 usd`);
if (
  price.recurring.interval !== "month" ||
  price.recurring.interval_count !== 1
)
  stop("the price must bill every month");

console.log(
  `Stripe check passed against ${target ? "the local stand-in" : "Stripe test mode"}: price ${price.id} bills every ${price.recurring.interval}.`,
);
