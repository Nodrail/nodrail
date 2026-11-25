import { defineConfig, devices } from "@playwright/test";
import { appTestDatabase, clientIpHeader } from "./e2e-app/environment";
import { appHost } from "./e2e-app/hosts";
import { testAuthRole, testDatabaseUrl } from "./tests/support/local-stack";

const { database, appRole } = appTestDatabase();
const port = 3201;
const baseURL = `http://127.0.0.1:${port}`;

const stripe = {
  STRIPE_API_BASE: "http://127.0.0.1:12122",
  STRIPE_SECRET_KEY: "sk_test_e2e",
  STRIPE_WEBHOOK_SECRET: "whsec_e2e",
  STRIPE_PRICE_PRO: "price_e2e_pro",
};

/**
 * The product, live: a production build against real Postgres and real local
 * auth. Nothing is mocked; sign-in emails are read from the local inbox.
 */
export default defineConfig({
  testDir: "./e2e-app",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  reporter: "list",
  globalSetup: "./e2e-app/global-setup.ts",
  use: { baseURL },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node scripts/fake-stripe.mjs",
      url: "http://127.0.0.1:12122/health",
      env: { ...stripe, APP_ORIGIN: baseURL },
      reuseExistingServer: false,
    },
    {
      command: `pnpm exec next build && pnpm exec next start --hostname 127.0.0.1 --port ${port}`,
      url: `${baseURL}/login`,
      env: {
        NEXT_DIST_DIR: ".next-e2e-app",
        DATABASE_URL: testDatabaseUrl(appRole, database),
        AUTH_DATABASE_URL: testDatabaseUrl(testAuthRole(database), database),
        APP_ORIGIN: baseURL,
        NODRAIL_DEPLOYMENT: "cloud",
        AUTH_CLIENT_IP_HEADER: clientIpHeader,
        APP_HOST: appHost,
        NEXT_PUBLIC_SHORT_PRODUCT_URLS: "false",
        SMTP_URL: "smtp://127.0.0.1:55325",
        SMTP_PLAINTEXT_HOST: "127.0.0.1",
        NOTIFICATIONS_FROM: "Nodrail <notifications@nodrail.test>",
        NOTIFICATIONS_SECRET: "local-e2e-secret",
        CRON_SECRET: "local-e2e-cron-secret",
        ...stripe,
      },
      reuseExistingServer: false,
      timeout: 240_000,
    },
  ],
});
