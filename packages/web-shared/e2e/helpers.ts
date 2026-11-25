import { resolve } from "node:path";
import { expect, type Page } from "@playwright/test";

// Browser checks both apps' suites share: the website's (apps/site/e2e) and
// the console's (apps/web/e2e-app). Each app has axe-core; this reads the
// copy of the app Playwright runs in.
const axePath = resolve("node_modules/axe-core/axe.min.js");

/**
 * Waits for entrance animations to end: text measured mid-fade reads as low
 * contrast. Endless ones (pending indicators) never end, so they don't count.
 */
async function settleAnimations(page: Page) {
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (animation) =>
          animation.playState !== "running" ||
          animation.effect?.getTiming().iterations === Infinity,
      ),
  );
}

/**
 * Waits for a page still streaming: its loading placeholders are marked busy
 * until the content they stand for replaces them.
 */
export async function waitForContent(page: Page) {
  await expect(page.locator("[aria-busy=true]")).toHaveCount(0);
}

export async function expectNoAxeViolations(page: Page) {
  // Check the page, not the placeholder it shows while it loads.
  await waitForContent(page);
  await settleAnimations(page);
  await page.addScriptTag({ path: axePath });
  const violations = await page.evaluate(async () => {
    const results = await (
      window as unknown as {
        axe: {
          run: (
            context: Document,
            options: object,
          ) => Promise<{
            violations: {
              id: string;
              nodes: { target: string[]; failureSummary?: string }[];
            }[];
          }>;
        };
      }
    ).axe.run(document, {
      runOnly: [
        "wcag2a",
        "wcag2aa",
        "wcag21a",
        "wcag21aa",
        "wcag22aa",
        "best-practice",
      ],
    });
    // The rule, and where: which elements and why, so a failure says what to fix.
    return results.violations.map(
      ({ id, nodes }) =>
        `${id}: ${nodes
          .slice(0, 5)
          .map(
            (node) =>
              `${node.target.join(" ")} (${node.failureSummary?.split("\n").pop()?.trim()})`,
          )
          .join("; ")}`,
    );
  });
  expect(violations).toEqual([]);
}

export async function expectNoOverflowOrClipping(page: Page) {
  const layout = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    clipped: [
      ...document.querySelectorAll(
        "a[data-slot=cta-link], h1, h2, h3, [data-slot=arrow-link]",
      ),
    ]
      .filter(
        (element) =>
          element.scrollWidth > element.clientWidth + 1 &&
          getComputedStyle(element).display !== "inline",
      )
      .map((element) => element.textContent),
  }));
  expect(layout).toEqual({ overflow: 0, clipped: [] });
}
