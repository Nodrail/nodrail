import { expect, test, type Page } from "@playwright/test";
import {
  expectAccessible,
  expectCopied,
  rowAction,
  startWorkspace,
  workspacePage,
  workspaceWithDecision,
} from "./helpers";
import { server } from "./hook";

/** A call from a script: a bearer token and no browser cookies. */
const api = (token: string, path: string, init: RequestInit = {}) =>
  fetch(`${server}/api/v1/${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
  });

async function createToken(page: Page, base: string, name: string) {
  await page.goto(workspacePage(base, "account/tokens"));
  await page.getByRole("button", { name: "Create token" }).click();
  const dialog = page.getByRole("dialog", { name: "Create an API token" });
  await dialog.getByLabel("Name").fill(name);
  await expect(
    dialog.getByText(/never give it to an agent/).first(),
  ).toBeVisible();
  await expect(dialog.getByRole("checkbox", { name: /decide/i })).toHaveCount(
    0,
  );
  await dialog.getByRole("checkbox", { name: /publish/i }).check();
  await expect(dialog.getByLabel("Expires after")).toHaveValue("90");
  await dialog.getByRole("button", { name: "Create token" }).click();
  const shown = page.getByLabel("API token", { exact: true });
  await expect(shown).toBeVisible();
  const secret = (await shown.textContent()) ?? "";
  expect(secret).toMatch(/^ndp_[0-9a-f]{12}_/);
  await expectCopied(page, secret);
  await expectAccessible(page);
  await page.getByRole("button", { name: "Done" }).click();
  await expect(shown).toBeHidden();
  return secret;
}

test.describe("API tokens", () => {
  test("a token is shown once, works from a script and stops when revoked", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const { base } = await workspaceWithDecision(page, `Tokens ${Date.now()}`);
    const secret = await createToken(page, base, "e2e laptop");

    await page.reload();
    const row = page
      .locator("[data-slot=data-table] tbody tr")
      .filter({ hasText: "e2e laptop" });
    await expect(row).toContainText("read, rules:write");
    await expect(row).toContainText(`${secret.slice(0, 16)}_…`);
    expect(await page.content()).not.toContain(secret.slice(17));

    const me = await api(secret, "me");
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({
      token: { name: "e2e laptop", scopes: ["read", "rules:write"] },
      can: { rules_write: true },
    });

    // The token reads what the rules decided; there is nothing to approve.
    const activity = await api(secret, "activity");
    expect(activity.status).toBe(200);
    const { items } = (await activity.json()) as { items: unknown[] };
    expect(items.length).toBeGreaterThan(0);
    expect((await api(secret, "approvals")).status).toBe(404);

    await page.goto(workspacePage(base, "account/tokens"));
    await rowAction(page, row, "Revoke…");
    await page.getByRole("button", { name: "Revoke token" }).click();
    await expect(row).toContainText("Revoked");
    const after = await api(secret, "me");
    expect(after.status).toBe(401);
    expect(await after.json()).toMatchObject({
      error: { code: "UNAUTHENTICATED" },
    });
  });

  test("a read-only token cannot publish rules", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const { base } = await startWorkspace(page, `Read ${Date.now()}`);
    await page.goto(workspacePage(base, "account/tokens"));
    await page.getByRole("button", { name: "Create token" }).click();
    const dialog = page.getByRole("dialog", { name: "Create an API token" });
    await dialog.getByLabel("Name").fill("reader");
    await expect(
      dialog.getByRole("checkbox", { name: /publish/i }),
    ).not.toBeChecked();
    await dialog.getByRole("button", { name: "Create token" }).click();
    const secret =
      (await page.getByLabel("API token", { exact: true }).textContent()) ?? "";
    const answer = await api(secret, "rules/preview", {
      method: "POST",
      body: JSON.stringify({ yaml: "version: 1\n" }),
    });
    expect(answer.status).toBe(403);
    expect(await answer.json()).toMatchObject({
      error: { code: "INSUFFICIENT_SCOPE" },
    });
  });
});
