import type { TourKey } from "@/contracts/v1/guidance";
import { setupTours } from "./tours-setup";
import { workTours } from "./tours-work";

/** One stop of a tour: the element it points at (`data-tour`) and what it says. */
export type TourStep = { anchor: string; title: string; body: string };

export type Tour = { label: string; steps: TourStep[] };

/**
 * One short tour per screen. Each step points at a real element; one that is
 * missing or hidden (an empty list, a phone layout) shows in the middle.
 */
export const tours: Record<TourKey, Tour> = { ...workTours, ...setupTours };

/**
 * The tour for the page at this path below the environment, if it has one:
 * `/overview`, `/policies`, `/policies/gates`, `/policies/budgets`,
 * `/policies/yaml`, a rule (its page, its edit form, the new rule form), a
 * gate's or budget's form,
 * `/agents`, `/agents/connect`, an agent's tabs, `/activity`,
 * `/activity/runs/<run>`, `/insights`, `/inventory`. An event opens over its
 * list and starts its own tour there.
 */
export function tourForSection(section: string): TourKey | null {
  const path = section.replace(/\/+$/, "");
  if (path === "/overview") return "overview";
  if (/^\/activity\/runs\/[^/]+$/.test(path)) return "run";
  if (["/policies", "/policies/gates", "/policies/budgets"].includes(path))
    return "policies";
  if (path === "/policies/yaml") return "policies-yaml";
  if (path === "/policies/import") return "import";
  if (/^\/policies\/(gates|budgets)\/(new|[^/]+\/edit)$/.test(path))
    return "run-policy";
  if (/^\/policies\/(?!import$)[^/]+(\/edit)?$/.test(path)) return "rule";
  if (path === "/agents") return "agents";
  if (path === "/agents/connect") return "connect";
  if (/^\/agents\/[^/]+(\/(rules|runs|settings))?$/.test(path)) return "agent";
  if (path === "/activity") return "activity";
  if (path === "/insights") return "insights";
  if (path === "/inventory") return "inventory";
  return null;
}

/** Pages of the workspace itself, in no environment, by their first segment. */
const workspaceTours: Partial<Record<string, TourKey>> = {
  settings: "settings",
  account: "account",
};

/**
 * The tour for the page at this path below the workspace, if it has one:
 * `/settings/…` and `/account/…`, or `/<environment>/<section>` as
 * `tourForSection` knows it.
 */
export function tourForPath(path: string): TourKey | null {
  const [first = "", ...rest] = path.split("/").filter(Boolean);
  return (
    workspaceTours[first] ??
    (first ? tourForSection(`/${rest.join("/")}`) : null)
  );
}
