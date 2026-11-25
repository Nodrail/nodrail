"use client";

import { track } from "@/components/analytics/posthog";
import { ActionForm } from "@/components/app/action-form";
import { Card, CardActions, FactList } from "@/components/app/card";
import { FormError } from "@/components/app/form-feedback";
import { useAppAction } from "@/components/app/use-app-action";
import { Button } from "@/components/ui/button";
import { plans, type BillingDto, type UsageDto } from "@/contracts/v1/billing";
import {
  formatDay,
  recommendationText,
  type UpgradeRecommendation,
} from "@/contracts/v1/usage-alerts";
import { formatUtc } from "@/lib/time";
import { openBillingPortalAction, startCheckoutAction } from "../actions";
import { FormHint, Note } from "@/components/app/note";
import { Progress } from "@/components/ui/progress";
import { useEffect } from "react";

function periodFact(billing: BillingDto) {
  if (!billing.renewsOrEndsAt) return [];
  return [
    {
      label: billing.cancelAtPeriodEnd ? "Ends" : "Renews",
      value: formatUtc(billing.renewsOrEndsAt),
    },
  ];
}

/** Why Pro might help, with the number behind it. Shown only with a reason. */
function Recommendation({ item }: { item: UpgradeRecommendation }) {
  const { reason } = item;
  useEffect(() => {
    track("upgrade_recommendation_shown", { reason });
  }, [reason]);
  return (
    <Note tone="info" data-slot="upgrade-recommendation">
      {recommendationText(item)}
    </Note>
  );
}

/** What happens at the limit, said whatever the usage, so it never surprises. */
const actionsAtLimit =
  "At the limit, new agent actions are blocked until usage resets or the plan changes.";
const stepsAtLimit =
  "At the limit, new run steps aren't recorded until usage resets or the plan changes, so gates waiting for them stay closed.";

const usageNotes: UsageNotes = {
  ok: actionsAtLimit,
  near: `This workspace is close to its monthly allowance. ${actionsAtLimit}`,
  reached:
    "Allowance used. New agent actions are blocked until usage resets or the plan changes.",
};

const stepNotes: UsageNotes = {
  ok: stepsAtLimit,
  near: `Close to this month's run steps. ${stepsAtLimit}`,
  reached:
    "Run steps used up. New steps aren't recorded until usage resets or the plan changes, so gates waiting for them stay closed.",
};

type UsageNotes = Record<UsageDto["state"], string>;

function UsageMeter({
  id,
  usage,
  unit,
  notes,
}: {
  id: string;
  usage: UsageDto;
  unit: string;
  notes: UsageNotes;
}) {
  const label = `${usage.used.toLocaleString("en")} of ${usage.limit.toLocaleString("en")} ${unit}`;
  const percent = usage.limit
    ? Math.min(100, (usage.used / usage.limit) * 100)
    : 0;
  return (
    <>
      <div className="mt-3.5 grid gap-1.5 text-ui text-body">
        <span id={`${id}-label`}>{label}</span>
        <Progress
          id={id}
          value={percent}
          aria-labelledby={`${id}-label`}
          getValueLabel={() => label}
          className="bg-muted *:data-[slot=progress-indicator]:bg-forest *:data-[slot=progress-indicator]:duration-500 *:data-[slot=progress-indicator]:ease-out"
        />
      </div>
      {usage.state === "ok" ? (
        <FormHint>{notes.ok}</FormHint>
      ) : (
        <Note tone="plain" role="status">
          {notes[usage.state]}
        </Note>
      )}
    </>
  );
}

/** What changed or is wrong with the plan, and who may change it. */
function BillingNotes({
  billing,
  returned,
}: {
  billing: BillingDto;
  returned?: string;
}) {
  return (
    <>
      {billing.paymentFailedUntil ? (
        <Note tone="plain" role="status">
          Your last payment failed. The plan stays active until{" "}
          {formatUtc(billing.paymentFailedUntil)} while it is retried.
        </Note>
      ) : null}
      {returned === "success" && billing.plan === "free" ? (
        <Note tone="plain" role="status">
          Payment received. Your plan updates in a moment; reload to see it.
        </Note>
      ) : null}
      {returned === "cancelled" ? (
        <Note tone="plain" role="status">
          No change was made to your plan.
        </Note>
      ) : null}
      {!billing.canManage ? (
        <FormHint>Only the workspace owner can change the plan.</FormHint>
      ) : null}
      {billing.canManage && !billing.available ? (
        <FormHint>Payments aren&apos;t set up on this server.</FormHint>
      ) : null}
    </>
  );
}

export function BillingCard({
  workspace,
  billing,
  returned,
}: {
  workspace: string;
  billing: BillingDto;
  returned?: string;
}) {
  const [checkout, startCheckout, starting] = useAppAction(
    startCheckoutAction.bind(null, workspace),
    (result) => {
      if (!result.data) return;
      track("checkout_started");
      window.location.assign(result.data.url);
    },
  );
  const checkingOut = starting || checkout.status === "ok";
  const [portal, openPortal, opening] = useAppAction(
    openBillingPortalAction.bind(null, workspace),
  );
  const { usage, plan } = billing;
  const upgrade = billing.canManage && billing.available && plan === "free";
  const manage = billing.canManage && billing.available && billing.hasCustomer;
  return (
    <Card
      title="Plan and usage"
      description="Limits apply to new agent actions. They never allow anything."
    >
      <FactList
        facts={[
          ...(billing.deployment === "self-hosted"
            ? [
                { label: "Plan", value: "Self-hosted" },
                { label: "Limits", value: "Set by your operator" },
              ]
            : [
                { label: "Plan", value: plans[plan].label },
                { label: "Price", value: plans[plan].priceLabel },
              ]),
          ...periodFact(billing),
          {
            label: "Usage resets",
            value: `${formatDay(billing.resetsAt)}, 00:00 UTC`,
          },
        ]}
      />
      <UsageMeter
        id="billing-usage"
        usage={usage}
        unit="agent actions this month"
        notes={usageNotes}
      />
      <UsageMeter
        id="billing-steps"
        usage={billing.steps}
        unit="run steps this month, included"
        notes={stepNotes}
      />
      {billing.recommendation ? (
        <Recommendation item={billing.recommendation} />
      ) : null}
      <BillingNotes billing={billing} returned={returned} />
      <FormError state={checkout} />
      <FormError state={portal} />
      <CardActions>
        {upgrade ? (
          <ActionForm action={startCheckout}>
            <Button type="submit" disabled={checkingOut}>
              {checkingOut
                ? "Opening…"
                : `Upgrade to ${plans.pro.label} · ${plans.pro.priceLabel}`}
            </Button>
          </ActionForm>
        ) : null}
        {manage ? (
          <ActionForm action={openPortal}>
            <Button type="submit" variant="outline" disabled={opening}>
              {opening ? "Opening…" : "Manage billing"}
            </Button>
          </ActionForm>
        ) : null}
      </CardActions>
    </Card>
  );
}
