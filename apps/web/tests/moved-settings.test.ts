import { describe, expect, test } from "vitest";
import { GET as settings } from "@/app/(product)/app/[workspace]/[environment]/settings/route";
import { GET as team } from "@/app/(product)/app/[workspace]/[environment]/team/route";

const params = Promise.resolve({ workspace: "acme" });

async function follow(
  handler: typeof settings,
  url: string,
): Promise<[number, string | null]> {
  const response = await handler(new Request(url), { params });
  return [response.status, response.headers.get("location")];
}

describe("Settings and Team in an environment moved to the workspace", () => {
  test("settings opens General, for good", async () => {
    expect(
      await follow(settings, "https://x.test/app/acme/development/settings"),
    ).toEqual([308, "https://x.test/app/acme/settings/general"]);
  });

  test("back from Stripe, settings opens Billing with the outcome", async () => {
    expect(
      await follow(
        settings,
        "https://x.test/app/acme/production/settings?billing=success",
      ),
    ).toEqual([
      308,
      "https://x.test/app/acme/settings/billing?billing=success",
    ]);
  });

  test("team opens Members", async () => {
    expect(
      await follow(team, "https://x.test/app/acme/development/team"),
    ).toEqual([308, "https://x.test/app/acme/settings/members"]);
  });
});
