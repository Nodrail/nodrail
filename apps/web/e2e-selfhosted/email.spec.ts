import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { connect, mailTo } from "../e2e-app/helpers";
import { acceptanceSql, workspaceSlug } from "./database";
import { readState, storagePath } from "./state";

test.use({ storageState: storagePath() });
test.setTimeout(180_000);

/** The local stack's mail sink, which the deployment sends to over SMTP. */
const SINK = process.env.ACCEPTANCE_MAIL_CONTAINER ?? "web-mailpit-1";
const docker = (...args: string[]) =>
  execFileSync("docker", args, { stdio: "ignore" });

async function inbox(email: string, subject: RegExp, seconds: number) {
  for (let waited = 0; waited < seconds; waited += 2) {
    const found = (await mailTo(email)).filter((item) =>
      subject.test(item.Subject),
    );
    if (found.length > 0) return found;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return [];
}

/**
 * Email on a self-hosted deployment, retried by its own scheduler: the
 * first send fails while the mail server is unreachable, and the scheduler
 * (every 30 s in the acceptance stack) delivers it once it's back.
 */
test("an integration inactivity alert is retried by the scheduler until delivered", async ({
  page,
  baseURL,
}) => {
  const { base, email } = readState();
  const agent = `mailer-${Date.now()}`;
  const credential = await connect(page, base, agent);
  const installation = await fetch(`${baseURL}/api/v1/runtime/identity`, {
    headers: { authorization: `Bearer ${credential}` },
  });
  expect(installation.ok).toBe(true);
  const slug = workspaceSlug(base);
  docker("pause", SINK);
  try {
    acceptanceSql(`
      UPDATE nodrail.installations i
      SET last_seen_at = now() - interval '45 minutes'
      FROM nodrail.workspaces w, nodrail.agents a
      WHERE w.id = i.workspace_id AND a.id = i.agent_id
        AND w.slug = '${slug}' AND a.external_key = '${agent}'
    `);
    await expect
      .poll(
        () =>
          acceptanceSql(`
        SELECT count(*) FROM nodrail.notification_outbox d
        JOIN nodrail.workspaces w ON w.id = d.workspace_id
        WHERE w.slug = '${slug}' AND d.kind = 'integration_stale'
          AND d.payload_safe->>'agent' = '${agent}'
          AND d.state = 'pending' AND d.last_error IS NOT NULL
      `),
        { timeout: 65_000 },
      )
      .toBe("1");
  } finally {
    docker("unpause", SINK);
  }
  const subject = new RegExp(`${agent} stopped reporting`);
  const delivered = await inbox(email, subject, 90);
  expect(delivered).toHaveLength(1);
});
