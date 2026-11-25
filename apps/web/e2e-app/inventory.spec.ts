import { expect, test } from "@playwright/test";
import { encodeSpans } from "../../../packages/policy-engine/src/otlp";
import { expectAccessible, startWorkspace, workspacePage } from "./helpers";
import { server } from "./hook";

/** One `nodrail.observation` span, as `nodrail observe` sends it. */
function observation(drift: string) {
  const at = (BigInt(Date.now()) * 1_000_000n).toString();
  return encodeSpans(
    [
      {
        traceId: "0af7651916cd43dd8448eb211c80319c",
        spanId: "b7ad6b7169203331",
        name: "nodrail.observation",
        start: at,
        end: at,
        attributes: {
          "nodrail.machine": "e".repeat(32),
          "nodrail.host": "codex",
          "nodrail.agent": "support",
          "nodrail.activation": "verified",
          "nodrail.in_step": drift === "0" ? "true" : "false",
          "nodrail.drift": drift,
          "nodrail.workspace.revision": "a".repeat(64),
          "nodrail.workspace.locked": "a".repeat(64),
          "nodrail.unmanaged.skill": "2",
        },
      },
    ],
    { "service.name": "nodrail", "nodrail.project": "support-desk" },
    "otlp-http/protobuf",
  );
}

test.describe("Inventory", () => {
  test("a reporting token sends a machine's setup; the page shows it", async ({
    page,
  }) => {
    const { base } = await startWorkspace(page, `Inventory ${Date.now()}`);
    await page.goto(`${base}/inventory`);
    await expect(page.getByText("No machine has reported yet")).toBeVisible();

    await page.goto(workspacePage(base, "account/tokens"));
    await page.getByRole("button", { name: "Create token" }).click();
    const dialog = page.getByRole("dialog", { name: "Create an API token" });
    await dialog.getByLabel("Name").fill("observe");
    await dialog.getByRole("checkbox", { name: /inventory:write/ }).check();
    await dialog.getByRole("button", { name: "Create token" }).click();
    const secret =
      (await page.getByLabel("API token", { exact: true }).textContent()) ?? "";
    expect(secret).toMatch(/^ndp_/);

    for (const drift of ["0", "3"]) {
      const { body, contentType } = observation(drift);
      const sent = await fetch(`${server}/api/v1/otlp/v1/traces`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${secret}`,
          "content-type": contentType,
        },
        body,
      });
      expect(sent.status).toBe(200);
    }
    // It reads nothing: it sits where agents run.
    const me = await fetch(`${server}/api/v1/me`, {
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(me.status).toBe(403);

    await page.goto(`${base}/inventory`);
    const row = page.locator("[data-slot=inventory-row]");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("support-desk");
    await expect(row).toContainText("Codex · starts as support");
    await expect(row).toContainText("You");
    await expect(row).toContainText("Drifted");
    await expect(row).toContainText("3 changed since apply");
    await expect(row).toContainText("2 skills");
    await expect(
      page.getByText(/1 setups on your team's machines/),
    ).toBeVisible();
    await expectAccessible(page);

    // The same token reports what the local hook decided, and a run step.
    const at = (BigInt(Date.now()) * 1_000_000n).toString();
    const reported = encodeSpans(
      [
        {
          traceId: "1af7651916cd43dd8448eb211c80319c",
          spanId: "c7ad6b7169203331",
          name: "nodrail.decision",
          start: at,
          end: at,
          attributes: {
            "nodrail.host": "codex",
            "nodrail.agent": "marketing",
            "nodrail.decision": "deny",
            "nodrail.tool": "outbox",
            "nodrail.operation": "publish",
            "nodrail.rule": "marketing-never-publishes",
          },
        },
        {
          traceId: "2af7651916cd43dd8448eb211c80319c",
          spanId: "d7ad6b7169203331",
          name: "nodrail.run.event",
          start: at,
          end: at,
          attributes: {
            "nodrail.host": "codex",
            "nodrail.run": "f".repeat(32),
            "nodrail.run.event": "step.finished",
            "nodrail.step": "s1",
            "nodrail.agent": "qa",
            "nodrail.verdict": "pass",
            "nodrail.findings": "0",
          },
        },
      ],
      {
        "service.name": "nodrail",
        "nodrail.schema": "2",
        "nodrail.project": "support-desk",
      },
      "otlp-http/json",
    );
    const sent = await fetch(`${server}/api/v1/otlp/v1/traces`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": reported.contentType,
      },
      body: reported.body,
    });
    expect(await sent.json()).toEqual({});
    await page.goto(`${base}/activity?view=local`);
    await expect(
      page.getByText("Received as OpenTelemetry traces."),
    ).toBeVisible();
    const decision = page.locator("[data-slot=reported-decision]");
    await expect(decision).toContainText("Denied locally");
    await expect(decision).toContainText("outbox publish");
    await expect(decision).toContainText(
      "Local enforcement · reported by this installation",
    );
    // Evidence only: nothing here can allow, deny or pause.
    await expect(
      page.getByRole("button", { name: /approve|deny|pause/i }),
    ).toHaveCount(0);
    await expect(page.locator("[data-slot=local-run]")).toContainText(
      "qa: verdict pass, 0 findings",
    );
    await expectAccessible(page);
  });
});
