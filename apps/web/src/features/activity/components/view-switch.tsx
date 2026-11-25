import { PageTabs } from "@/components/app/page-tabs";
import type {
  ActivityQuery,
  ActivityView,
} from "@/contracts/v1/activity-query";
import { activityHref } from "../filters";

const views: { value: ActivityView; label: string }[] = [
  { value: "events", label: "Events" },
  { value: "runs", label: "Runs" },
  { value: "local", label: "OTLP reports" },
];

/**
 * Each event, or the runs they belong to: line tabs like every other page's
 * sections. Links, so a view can be shared; the filters both views read come
 * along, and the page starts from the newest.
 */
export function ViewSwitch({
  path,
  query,
  view,
}: {
  path: string;
  query: ActivityQuery;
  view: ActivityView;
}) {
  return (
    <PageTabs
      label="Activity view"
      tour="activity-views"
      current={view}
      tabs={views.map((option) => ({
        ...option,
        href: activityHref(path, { ...query, cursor: undefined }, option.value),
      }))}
    />
  );
}
