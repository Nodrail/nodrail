import { movedToSettings } from "@/features/shell/moved-settings";

/** Back from Stripe with `?billing=`, to the billing page; otherwise General. */
export const GET = movedToSettings((query) =>
  query.has("billing") ? "billing" : "general",
);
