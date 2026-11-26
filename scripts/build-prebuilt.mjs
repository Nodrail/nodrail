// Build a Vercel artifact from a prepared workspace using local settings.
// Run in an isolated build environment with only public build-time variables.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const app = process.argv[2];
if (!["web", "site"].includes(app)) throw new Error("Select web or site.");
const root = process.cwd();
if (existsSync(join(root, ".git")))
  throw new Error("Build from a prepared archive in an isolated environment.");
const appDir = join(root, "apps", app);
const linkDir = join(appDir, ".vercel");
mkdirSync(linkDir);
writeFileSync(
  join(linkDir, "project.json"),
  JSON.stringify({
    orgId: "team_local",
    projectId: "prj_local",
    settings: {
      framework: "nextjs",
      nodeVersion: "22.x",
      rootDirectory: `apps/${app}`,
    },
  }),
);

const env = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  CI: "1",
  VERCEL_TELEMETRY_DISABLED: "1",
};
execFileSync("pnpm", ["install", "--frozen-lockfile"], {
  cwd: root,
  env,
  stdio: "inherit",
});
execFileSync(
  "pnpm",
  [
    "dlx",
    "vercel@65.12.1",
    "build",
    "--prod",
    "--output",
    join(root, ".vercel/output"),
  ],
  {
    cwd: appDir,
    stdio: "inherit",
    env: {
      ...env,
      VERCEL: "1",
      NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY ?? "",
      ...(app === "web"
        ? {
            NODRAIL_DEPLOYMENT: "cloud",
            NEXT_PUBLIC_SHORT_PRODUCT_URLS: "true",
          }
        : {
            APP_HOST: process.env.APP_HOST ?? "",
            NEXT_PUBLIC_GTM_ID: process.env.NEXT_PUBLIC_GTM_ID ?? "",
            NEXT_PUBLIC_TURNSTILE_SITE_KEY:
              process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "",
          }),
    },
  },
);
