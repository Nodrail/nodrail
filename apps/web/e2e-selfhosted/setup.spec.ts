import { expect, test, type Page } from "@playwright/test";
import {
  createWorkspace,
  startWorkspace,
  workspacePage,
} from "../e2e-app/helpers";
import { saveState, storagePath } from "./state";

async function acceptanceWorkspace(page: Page) {
  const email = process.env.ACCEPTANCE_EMAIL;
  const password = process.env.ACCEPTANCE_PASSWORD;
  const name = `Acceptance ${Date.now()}`;
  if (!email && !password) return startWorkspace(page, name, { tours: true });
  if (!email || !password) throw new Error("Set both acceptance login values");

  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/app(?:\/|$)/);
  await page.goto("/app/new");
  await createWorkspace(page, name);
  const slug = new URL(page.url()).pathname.split("/")[2];
  return { email, base: `/app/${slug}/development` };
}

/**
 * A fresh person and workspace on the running deployment, and a reporting
 * token made the way a person makes one, for the installation to use.
 */
test("a workspace and a reporting token", async ({ page }) => {
  const { email, base } = await acceptanceWorkspace(page);
  await page.goto(workspacePage(base, "account/tokens"));
  await page.getByRole("button", { name: "Create token" }).click();
  const dialog = page.getByRole("dialog", { name: "Create an API token" });
  await dialog.getByLabel("Name").fill("acceptance installation");
  await dialog.getByRole("checkbox", { name: /inventory:write/ }).check();
  await dialog.getByRole("button", { name: "Create token" }).click();
  const token =
    (await page.getByLabel("API token", { exact: true }).textContent()) ?? "";
  expect(token).toMatch(/^ndp_[0-9a-f]{12}_/);
  const storage = storagePath();
  await page.context().storageState({ path: storage });
  saveState({ email, base, token, storage });
});
