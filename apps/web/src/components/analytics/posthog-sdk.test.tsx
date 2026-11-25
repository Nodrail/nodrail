import { act } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";

// The real SDK, so this sees exactly the properties it attaches to an event.
const scrubbed = vi.hoisted(() => [] as unknown[]);
vi.mock("@nodrail/web-shared/analytics/sanitize", async (original) => {
  const actual =
    await original<typeof import("@nodrail/web-shared/analytics/sanitize")>();
  return {
    ...actual,
    scrubEvent: (...args: Parameters<typeof actual.scrubEvent>) => {
      const result = actual.scrubEvent(...args);
      if (result) scrubbed.push(result);
      return result;
    },
  };
});

const secret = "SECRET-token-value";
const fetchMock = vi.fn(
  async (_url: string) => new Response("{}", { status: 200 }),
);

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test");
  window.localStorage.setItem("nodrail-analytics-consent", "granted");
});

test("what the real SDK would send carries no sensitive data", async () => {
  document.title = `Agent ${secret}`;
  window.history.pushState(
    {},
    "",
    `/invite/${secret}?token_hash=${secret}&next=/app/x#${secret}`,
  );
  Object.defineProperty(document, "referrer", {
    configurable: true,
    value: `${window.location.origin}/app/acme/prod/agents/${secret}`,
  });

  const { capturePageview, setAnalyticsIdentity, startPosthog, track } =
    await import("./posthog");
  await act(() => startPosthog("product"));

  setAnalyticsIdentity("user-1", "workspace-1");
  capturePageview();
  track("rule_created");
  const button = document.body.appendChild(document.createElement("button"));
  button.textContent = secret;
  button.click();
  await act(() => new Promise((done) => setTimeout(done, 20)));

  const events = scrubbed as {
    event: string;
    properties: Record<string, unknown>;
  }[];
  expect(events.map(({ event }) => event)).toEqual(
    expect.arrayContaining([
      "$identify",
      "$groupidentify",
      "$pageview",
      "rule_created",
    ]),
  );
  expect(events.map(({ event }) => event)).not.toContain("$autocapture");
  expect(JSON.stringify(events)).not.toContain(secret);
  expect(
    events.find(({ event }) => event === "$pageview")?.properties,
  ).toMatchObject({
    $current_url: `${window.location.origin}/invite/[token]`,
    $pathname: "/invite/[token]",
  });
  const rule = events.find(({ event }) => event === "rule_created")?.properties;
  expect(rule?.$groups).toEqual({ workspace: "workspace-1" });
  expect(rule?.distinct_id).toBe("user-1");
  // Flag requests would carry person properties around `before_send`.
  const requested = fetchMock.mock.calls.map(([url]) => url);
  expect(requested.filter((url) => url.includes("/flags"))).toEqual([]);
});
