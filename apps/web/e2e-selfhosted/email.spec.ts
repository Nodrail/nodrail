import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { connect, mailTo } from "../e2e-app/helpers";
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
test("a permission request email is retried by the scheduler until delivered", async ({
  page,
  baseURL,
}) => {
  const { base, email } = readState();
  const agent = `mailer-${Date.now()}`;
  const credential = await connect(page, base, agent);
  docker("pause", SINK);
  try {
    const submitted = await fetch(`${baseURL}/api/v1/runtime/actions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${credential}`,
        "content-type": "application/json",
        "idempotency-key": randomUUID(),
      },
      body: JSON.stringify({
        tool: "github",
        operation: "issues.create",
        resource: { kind: "repository", id: "acme/app" },
        params: {},
      }),
    });
    expect(submitted.status).toBeLessThan(300);
    await new Promise((resolve) => setTimeout(resolve, 5000));
  } finally {
    docker("unpause", SINK);
  }
  const subject = new RegExp(`${agent} asked for a new permission`);
  const delivered = await inbox(email, subject, 90);
  expect(delivered).toHaveLength(1);
});
