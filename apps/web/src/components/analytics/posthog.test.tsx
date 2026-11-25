import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { PostHogConfig } from "posthog-js";

const client = vi.hoisted(() => ({
  init: vi.fn(),
  capture: vi.fn(),
  identify: vi.fn(),
  group: vi.fn(),
  resetGroups: vi.fn(),
  reset: vi.fn(),
  get_property: vi.fn(),
}));
vi.mock("posthog-js", () => ({ default: client }));

let pathname = "/app/acme/prod/agents/secret-agent";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

const copy = {
  message: "We use PostHog.",
  privacy: "Privacy",
  accept: "Accept",
  reject: "Reject",
};
const KEY = "nodrail-analytics-consent";

async function load() {
  vi.resetModules();
  const consent = await import("@nodrail/web-shared/analytics/consent");
  const posthog = await import("./posthog");
  return { ...consent, ...posthog };
}

const settle = () => act(() => new Promise((done) => setTimeout(done, 0)));

async function mount(surface: "product" | "marketing" = "product") {
  const modules = await load();
  const view = render(
    <modules.AnalyticsConsent
      copy={copy}
      privacyHref="/privacy"
      buttonClassName="button"
      surface={surface}
    />,
  );
  await settle();
  return { ...modules, view };
}

const accept = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Accept" }));
  await settle();
};

const tagScripts = () =>
  [...document.querySelectorAll("script")].filter((s) =>
    s.src.includes("googletagmanager"),
  );

const config = () => client.init.mock.calls[0]?.[1] as Partial<PostHogConfig>;

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  Object.values(client).forEach((fn) => fn.mockClear());
  client.get_property.mockReturnValue(undefined);
  tagScripts().forEach((script) => script.remove());
  pathname = "/app/acme/prod/agents/secret-agent";
  window.history.pushState({}, "", pathname);
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test");
  vi.stubEnv("NEXT_PUBLIC_GTM_ID", "GTM-TEST");
});
afterEach(() => vi.unstubAllEnvs());

describe("before consent", () => {
  test("the product shows the banner and starts nothing", async () => {
    const { track } = await mount();
    expect(screen.getByText("We use PostHog.", { exact: false })).toBeVisible();
    track("rule_created");
    await settle();
    expect(client.init).not.toHaveBeenCalled();
    expect(client.capture).not.toHaveBeenCalled();
    expect(client.identify).not.toHaveBeenCalled();
  });

  test("a product with only a tag manager id asks nothing", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "");
    await mount();
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
  });
});

describe("after Accept on the product", () => {
  test("loads PostHog with data collection locked down, and never GTM", async () => {
    await mount();
    await accept();
    expect(tagScripts()).toHaveLength(0);
    expect(config()).toMatchObject({
      autocapture: false,
      mask_all_text: true,
      mask_all_element_attributes: true,
      capture_pageview: false,
      disable_session_recording: true,
      capture_heatmaps: false,
      rageclick: false,
      capture_dead_clicks: false,
      capture_exceptions: false,
      capture_performance: false,
      advanced_disable_flags: true,
      disable_surveys: true,
      persistence: "localStorage",
    });
  });

  test("records the current page, once", async () => {
    await mount();
    await accept();
    expect(client.capture.mock.calls).toEqual([["$pageview"]]);
  });

  test("records a client navigation", async () => {
    const { AnalyticsConsent, view } = await mount();
    await accept();
    pathname = "/app/acme/prod/agents";
    window.history.pushState({}, "", pathname);
    view.rerender(
      <AnalyticsConsent
        copy={copy}
        privacyHref="/x"
        buttonClassName="button"
        surface="product"
      />,
    );
    await settle();
    expect(client.capture).toHaveBeenCalledTimes(2);
  });

  test("identifies by internal ids, even when consent comes later", async () => {
    const { setAnalyticsIdentity } = await mount();
    setAnalyticsIdentity("user-1", "workspace-1");
    expect(client.identify).not.toHaveBeenCalled();
    await accept();
    expect(client.identify.mock.calls).toEqual([["user-1"]]);
    expect(client.group.mock.calls).toEqual([["workspace", "workspace-1"]]);
  });

  test("named events go through, and only the typed properties", async () => {
    const { track } = await mount();
    await accept();
    track("agent_connected", { adapter: "custom-sdk" });
    expect(client.capture).toHaveBeenLastCalledWith("agent_connected", {
      adapter: "custom-sdk",
    });
  });

  test("leaving a workspace drops its group", async () => {
    const { setAnalyticsIdentity, clearAnalyticsWorkspace } = await mount();
    await accept();
    setAnalyticsIdentity("user-1", "workspace-1");
    clearAnalyticsWorkspace();
    expect(client.resetGroups).toHaveBeenCalledOnce();
  });

  test("a signed-out page forgets the last identified person", async () => {
    pathname = "/login";
    window.history.pushState({}, "", pathname);
    client.get_property.mockReturnValue("identified");
    await mount();
    await accept();
    expect(client.reset).toHaveBeenCalledOnce();
  });
});

describe("marketing", () => {
  // Google Tag Manager is the website's own (apps/site), passed as `scripts`.
  test("keeps autocapture, and loads no tag manager of its own", async () => {
    pathname = "/";
    window.history.pushState({}, "", pathname);
    await mount("marketing");
    await accept();
    expect(tagScripts()).toHaveLength(0);
    expect(config()).toMatchObject({ autocapture: true, mask_all_text: false });
  });
});

describe("withdrawal and sharing", () => {
  test("a choice made on one surface applies on the other", async () => {
    window.localStorage.setItem(KEY, "denied");
    await mount();
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
    await settle();
    expect(client.init).not.toHaveBeenCalled();
  });

  test("PostHog's stored data is removed once consent is not held", async () => {
    window.localStorage.setItem(KEY, "denied");
    window.localStorage.setItem("ph_phc_test_posthog", "{}");
    window.sessionStorage.setItem("ph_phc_test_window_id", "x");
    window.localStorage.setItem("nodrail.sidebar.collapsed", "true");
    await mount();
    expect(window.localStorage.getItem("ph_phc_test_posthog")).toBeNull();
    expect(window.sessionStorage.getItem("ph_phc_test_window_id")).toBeNull();
    expect(window.localStorage.getItem("nodrail.sidebar.collapsed")).toBe(
      "true",
    );
  });

  test("an already-running page sends nothing after a withdrawal", async () => {
    await mount();
    await accept();
    const send = config().before_send as (event: never) => unknown;
    const pageview = { event: "$pageview", properties: {} } as never;
    expect(send(pageview)).toBeTruthy();
    window.localStorage.setItem(KEY, "denied");
    expect(send(pageview)).toBeNull();
  });
});
