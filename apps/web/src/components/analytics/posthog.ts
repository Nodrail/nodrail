import type { starterPacks } from "@nodrail/sdk/yaml";
import { captureEvent } from "@nodrail/web-shared/analytics/posthog";
import type { ProductEvent } from "@nodrail/web-shared/analytics/sanitize";
import type { AdapterKey } from "@/contracts/v1/agents";
import type { FirstStepKey, TourKey } from "@/contracts/v1/guidance";
import type {
  UpgradeReason,
  UsageMetric,
  UsageThreshold,
} from "@/contracts/v1/usage-alerts";

// The consent and the PostHog client are shared with the website; the
// product's own events and their properties are typed here.
export {
  CONSENT_KEY,
  capturePageview,
  clearAnalyticsWorkspace,
  forgetPosthogData,
  readConsent,
  setAnalyticsIdentity,
  startPosthog,
  type ConsentChoice,
} from "@nodrail/web-shared/analytics/posthog";

/** Closed values only: free text from a form or an agent must not fit here. */
type EventProperties = {
  workspace_created: { workspace_id: string };
  agent_connected: { adapter: AdapterKey };
  starter_pack_chosen: { pack: keyof typeof starterPacks };
  tour_started: { tour: TourKey };
  tour_completed: { tour: TourKey };
  tour_skipped: { tour: TourKey };
  checklist_item_done: { item: FirstStepKey };
  usage_banner_shown: { metric: UsageMetric; threshold: UsageThreshold };
  usage_banner_dismissed: { metric: UsageMetric; threshold: UsageThreshold };
  upgrade_recommendation_shown: { reason: UpgradeReason };
};

export function track<Event extends ProductEvent>(
  event: Event,
  ...[properties]: Event extends keyof EventProperties
    ? [EventProperties[Event]]
    : []
) {
  captureEvent(event, properties);
}
