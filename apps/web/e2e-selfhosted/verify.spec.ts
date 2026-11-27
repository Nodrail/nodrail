import { expect, test } from "@playwright/test";
import { expectAccessible } from "../e2e-app/helpers";
import { readState, storagePath } from "./state";

/**
 * After the installation ran: what the deployment shows for it. The
 * expected text comes from the acceptance run (ACCEPTANCE_EXPECT, JSON).
 */
const expected = JSON.parse(process.env.ACCEPTANCE_EXPECT ?? "{}") as {
  project?: string;
  hosts?: string[];
  decisions?: string[];
  runs?: string[];
};

test.use({ storageState: storagePath() });

test("the inventory and the local reports show what ran", async ({ page }) => {
  const { base } = readState();
  await page.goto(`${base}/inventory`);
  const rows = page.locator("[data-slot=inventory-row]");
  // A host may report several projects (or a renamed clone): any row will do.
  for (const host of expected.hosts ?? [])
    await expect(
      rows
        .filter({ hasText: host })
        .filter({ hasText: expected.project ?? "" }),
    ).not.toHaveCount(0);
  await expect(rows.first()).toContainText(
    "Local enforcement · reported by this installation",
  );
  await page.screenshot({
    path: `${process.env.ACCEPTANCE_STATE}.inventory.png`,
    fullPage: true,
  });
  await page.goto(`${base}/activity?view=local`);
  await expect(
    page.getByText(
      "Reporting connected. Each local hook decides on its own machine.",
    ),
  ).toBeVisible();
  for (const text of expected.decisions ?? [])
    await expect(
      page.locator("[data-slot=reported-decision]").filter({ hasText: text }),
    ).not.toHaveCount(0);
  for (const text of expected.runs ?? [])
    await expect(
      page.locator("[data-slot=local-run]").filter({ hasText: text }),
    ).not.toHaveCount(0);
  await expect(page.getByRole("button", { name: /deny|pause/i })).toHaveCount(
    0,
  );
  await page.screenshot({
    path: `${process.env.ACCEPTANCE_STATE}.local.png`,
    fullPage: true,
  });
  await expectAccessible(page);
});
