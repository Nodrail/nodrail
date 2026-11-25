import { defineConfig, devices } from "@playwright/test";

/**
 * Acceptance against a deployment that is already running, such as the
 * self-hosted Compose stack (apps/site/content/pages/self-hosting.md). Nothing is
 * started here. The deployment sends sign-in links to the test SMTP relay.
 *   ACCEPTANCE_URL   the deployment (default http://127.0.0.1:3201)
 *   ACCEPTANCE_STATE where the setup writes its workspace and token
 *   ACCEPTANCE_PROJECT and ACCEPTANCE_DEPLOY  the Compose project name and
 *                    its folder (apps/web/deploy), for the commands the
 *                    limits checks run against its database
 *   ACCEPTANCE_INBOX_URL   the Mailpit HTTP endpoint (default http://127.0.0.1:55324)
 *   ACCEPTANCE_MAIL_CONTAINER   dedicated SMTP container the retry check pauses
 *   ACCEPTANCE_EMAIL / ACCEPTANCE_PASSWORD   optional pre-provisioned login
 */
export default defineConfig({
  testDir: "./e2e-selfhosted",
  workers: 1,
  reporter: "list",
  use: { baseURL: process.env.ACCEPTANCE_URL ?? "http://127.0.0.1:3201" },
  // Setup signs in and writes ACCEPTANCE_STATE; every other spec reads it.
  projects: [
    {
      name: "setup",
      testMatch: /setup\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium",
      testIgnore: /setup\.spec\.ts/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
