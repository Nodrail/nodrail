/**
 * The approved offer (10 November 2026): per workspace, governed actions per
 * UTC calendar month. The amount charged is the Stripe price STRIPE_PRICE_PRO,
 * which must match priceLabel. Run steps are free, up to the same number a
 * month: an allowance against abuse, never billed (R51).
 */
export const plans = {
  free: {
    label: "Free",
    intentsPerMonth: 1000,
    stepsPerMonth: 1000,
    monthlyUsd: 0,
    priceLabel: "Free",
  },
  pro: {
    label: "Pro",
    intentsPerMonth: 100_000,
    stepsPerMonth: 100_000,
    monthlyUsd: 29,
    priceLabel: "$29 / month",
  },
} as const;

export type PlanKey = keyof typeof plans;
