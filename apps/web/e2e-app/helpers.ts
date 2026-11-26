import { randomBytes, randomUUID } from "node:crypto";
import {
  expect,
  type Browser,
  type Locator,
  type Page,
} from "@playwright/test";
import { Client } from "pg";
import { tourKeys } from "../src/contracts/v1/guidance";
import { testDatabaseUrl } from "../tests/support/local-stack";
import { appTestDatabase, clientIpHeader } from "./environment";

const inbox = process.env.ACCEPTANCE_INBOX_URL ?? "http://127.0.0.1:55324";

export {
  expectNoAxeViolations as expectAccessible,
  waitForContent,
} from "@nodrail/web-shared/e2e";

export const newEmail = () => `person-${randomUUID()}@example.test`;

type MailSummary = { ID: string; Subject: string };

export const mailTo = async (email: string) => {
  const search = await fetch(
    `${inbox}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`,
  );
  return ((await search.json()) as { messages: MailSummary[] }).messages;
};

const readMail = async (id: string) =>
  (await (await fetch(`${inbox}/api/v1/message/${id}`)).json()) as {
    HTML: string;
    Text: string;
  };

/** The newest email to this address with this subject, from the real inbox. */
export async function waitForMail(email: string, subject: RegExp) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const found = (await mailTo(email)).find((item) =>
      subject.test(item.Subject),
    );
    if (found) return { subject: found.Subject, ...(await readMail(found.ID)) };
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`No email to ${email} matching ${subject}`);
}

/** The newest link sent to this address, from the real local inbox. */
export async function signInLink(email: string, ignore: string[] = []) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    for (const message of await mailTo(email)) {
      if (ignore.includes(message.ID)) continue;
      const match = /href="([^"]*\/auth\/confirm[^"]*)"/.exec(
        (await readMail(message.ID)).HTML,
      );
      if (match?.[1])
        return { id: message.ID, url: match[1].replaceAll("&amp;", "&") };
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`No sign-in email for ${email}`);
}

const configuredAuthPages = new WeakSet<Page>();

export async function setAuthSource(page: Page) {
  if (configuredAuthPages.has(page)) return;
  // Each page models a distinct client IP at a trusted proxy.
  const bytes = randomBytes(6);
  const prefix = [0, 2, 4].map((offset) =>
    bytes.readUInt16BE(offset).toString(16),
  );
  await page.setExtraHTTPHeaders({
    [clientIpHeader]: `fd00:${prefix.join(":")}::1`,
  });
  configuredAuthPages.add(page);
}

export async function requestLink(page: Page, email: string, path = "/login") {
  const previous = (await mailTo(email)).map(({ ID }) => ID);
  await setAuthSource(page);
  await page.goto(path);
  if (new URL(page.url()).pathname === "/login") {
    await page.getByRole("link", { name: "Email me a sign-in link" }).click();
    await expect(
      page.getByRole("heading", { name: "Sign in with email" }),
    ).toBeVisible();
  }
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByRole("button", { name: /link|continue/i }).click();
  await expect(page.getByRole("status")).toContainText("Check your email");
  return previous;
}

/** Every screen's tour, so a test can start with all or none of them seen. */
export const TOURS: readonly string[] = tourKeys;

/**
 * Records the tours as already shown to this person, as for someone who has
 * used the product before: a tour opening by itself would sit over the page
 * every other spec is testing. The guidance spec signs in without this.
 */
export function markToursSeen(email: string) {
  return withDatabase((client) =>
    client.query(
      `INSERT INTO nodrail.user_guidance (user_id, key)
       SELECT u.id, 'tour:' || tour
       FROM nodrail.users u, unnest($2::text[]) AS tour
       WHERE u.verified_email = $1
       ON CONFLICT DO NOTHING`,
      [email, TOURS],
    ),
  );
}

export async function signIn(
  page: Page,
  email = newEmail(),
  path = "/login",
  { tours = false }: { tours?: boolean } = {},
) {
  const previous = await requestLink(page, email, path);
  const { url } = await signInLink(email, previous);
  await page.goto(url);
  await page.getByRole("button", { name: "Continue to Nodrail" }).click();
  await page.waitForURL(/\/app/);
  if (!tours) await markToursSeen(email);
  return email;
}

export async function createWorkspace(page: Page, name: string) {
  await page.getByLabel("Workspace name").fill(name);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await page.waitForURL(/\/overview$/);
}

export async function signOut(page: Page) {
  await page.getByLabel(/your account/i).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL("/login");
}

/** Signs a new person in and creates a workspace, ready to use. */
export async function startWorkspace(
  page: Page,
  name: string,
  options: { tours?: boolean } = {},
) {
  const email = await signIn(page, newEmail(), "/login", options);
  await createWorkspace(page, name);
  const { pathname } = new URL(page.url());
  const slug = pathname.split("/")[2] ?? "";
  return { email, slug, home: page.url(), base: `/app/${slug}/development` };
}

/**
 * A page of the workspace's settings or of your account, which are in no
 * environment, from an environment's path: `/app/acme/development` and
 * `settings/billing` give `/app/acme/settings/billing`.
 */
export const workspacePage = (base: string, page: string) =>
  `${base.replace(/\/[^/]+$/, "")}/${page}`;

/** A new workspace with one connected agent. */
export async function connectedWorkspace(
  page: Page,
  label: string,
  agent = "support",
) {
  const workspace = await startWorkspace(page, `${label} ${Date.now()}`);
  await connect(page, workspace.base, agent);
  return workspace;
}

/** The same, with one decision recorded: a call no rule covered, denied. */
export async function workspaceWithDecision(
  page: Page,
  label: string,
  agent = "support",
) {
  const workspace = await connectedWorkspace(page, label, agent);
  await seedDecision(workspace.slug, agent);
  return workspace;
}

export async function expectFitsPhone(page: Page) {
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
}

/** A new workspace, viewed at phone width. */
export async function workspaceOnPhone(page: Page, label: string) {
  await page.setViewportSize({ width: 390, height: 844 });
  return startWorkspace(page, `${label} ${Date.now()}`);
}

/** A new person, in their own browser, added to a workspace with this role. */
export async function addTeammate(
  browser: Browser,
  slug: string,
  role: string,
) {
  const page = await (await browser.newContext()).newPage();
  const email = await signIn(page);
  await withDatabase((client) =>
    client.query(
      `INSERT INTO nodrail.workspace_memberships (workspace_id, user_id, role)
       SELECT w.id, u.id, $3
       FROM nodrail.workspaces w, nodrail.users u
       WHERE w.slug = $1 AND u.verified_email = $2`,
      [slug, email, role],
    ),
  );
  return { page, email };
}

/** A workspace, and a new viewer already looking at one of its pages. */
export async function viewerOn(
  page: Page,
  browser: Browser,
  label: string,
  section: string,
) {
  const workspace = await startWorkspace(page, `${label} ${Date.now()}`);
  const viewer = await addTeammate(browser, workspace.slug, "viewer");
  await viewer.page.goto(`${workspace.base}/${section}`);
  return { ...workspace, viewer: viewer.page };
}

export async function withDatabase<T>(run: (client: Client) => Promise<T>) {
  const client = new Client({
    connectionString: testDatabaseUrl("postgres", appTestDatabase().database),
  });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

/** A workspace's agent actions (and run steps) for this month or one before. */
export const setUsage = (
  slug: string,
  intents: number,
  options: { steps?: number; monthsAgo?: number } = {},
) =>
  withDatabase((client) =>
    client.query(
      `INSERT INTO nodrail.billing_usage (workspace_id, period, intents, steps)
       SELECT id, (date_trunc('month', timezone('UTC', now()))
                   - make_interval(months => $4))::date, $2, $3
       FROM nodrail.workspaces WHERE slug = $1
       ON CONFLICT (workspace_id, period) DO UPDATE
       SET intents = EXCLUDED.intents, steps = EXCLUDED.steps`,
      [slug, intents, options.steps ?? 0, options.monthsAgo ?? 0],
    ),
  );

/**
 * A call no rule covered, denied and recorded as an integration's would be:
 * its action and its decision in Activity. Nothing waits for a person.
 */
export function seedDecision(
  slug: string,
  agentKey: string,
  {
    tool = "github",
    operation = "issues.delete",
    kind = "issue",
    resource = "acme/support#482",
    params = { issue: 482 } as object,
    hold = null as object | null,
  } = {},
) {
  return withDatabase((client) =>
    client.query(
      `WITH target AS (
         SELECT i.workspace_id, i.id AS installation_id, i.agent_id,
                i.environment_id, p.policy_version_id, gen_random_uuid() AS action
         FROM nodrail.installations i
         JOIN nodrail.workspaces w ON w.id = i.workspace_id
         JOIN nodrail.agents a ON a.id = i.agent_id
         JOIN nodrail.active_policies p
           ON p.workspace_id = i.workspace_id AND p.environment_id = i.environment_id
         WHERE w.slug = $1 AND a.external_key = $2
         LIMIT 1
       ), action AS (
         INSERT INTO nodrail.action_requests
           (id, workspace_id, installation_id, agent_id, environment_id,
            idempotency_key, tool_key, operation_key, resource_kind, resource_id,
            params_safe,
            permission_fingerprint, descriptor_digest, action_digest,
            initial_policy_version_id, access_epoch, initial_evaluation, expires_at,
            run_hold)
         SELECT action, workspace_id, installation_id, agent_id, environment_id,
                gen_random_uuid()::text, $3, $4, $5, $6, $7::jsonb, 'fp', 'd', 'a',
                policy_version_id, 1,
                'denied', now() + interval '1 hour', $8::jsonb
         FROM target
         RETURNING id, workspace_id, agent_id, environment_id,
                   initial_policy_version_id
       )
       INSERT INTO nodrail.audit_events
         (workspace_id, event_type, actor_kind, action_request_id, agent_id,
          environment_id, policy_version_id, decision_code)
       SELECT workspace_id, 'authorization.decided', 'runtime', id, agent_id,
              environment_id, initial_policy_version_id, 'denied_no_rule'
       FROM action`,
      [
        slug,
        agentKey,
        tool,
        operation,
        kind,
        resource,
        JSON.stringify(params),
        hold ? JSON.stringify(hold) : null,
      ],
    ),
  );
}

/** A report from the integration on an agent's latest request. */
export function seedClientReport(
  slug: string,
  agentKey: string,
  outcome: "success" | "failure" | "unknown",
  details: object = {},
) {
  return withDatabase((client) =>
    client.query(
      `INSERT INTO nodrail.client_reports
         (workspace_id, installation_id, action_request_id, client_report_key,
          outcome, details_safe)
       SELECT ar.workspace_id, ar.installation_id, ar.id, gen_random_uuid()::text,
              $3, $4::jsonb
       FROM nodrail.action_requests ar
       JOIN nodrail.workspaces w ON w.id = ar.workspace_id
       JOIN nodrail.agents a ON a.id = ar.agent_id
       WHERE w.slug = $1 AND a.external_key = $2
       ORDER BY ar.created_at DESC
       LIMIT 1`,
      [slug, agentKey, outcome, JSON.stringify(details)],
    ),
  );
}

export function setLastSeen(slug: string, agentKey: string, minutes: number) {
  return withDatabase((client) =>
    client.query(
      `UPDATE nodrail.installations i
       SET last_seen_at = now() - make_interval(mins => $3)
       FROM nodrail.workspaces w, nodrail.agents a
       WHERE w.id = i.workspace_id AND a.id = i.agent_id
         AND w.slug = $1 AND a.external_key = $2`,
      [slug, agentKey, minutes],
    ),
  );
}

export function assignAgent(slug: string, agentKey: string, email: string) {
  return withDatabase((client) =>
    client.query(
      `INSERT INTO nodrail.agent_members (workspace_id, agent_id, user_id)
       SELECT w.id, a.id, u.id
       FROM nodrail.workspaces w
       JOIN nodrail.agents a ON a.workspace_id = w.id
       JOIN nodrail.users u ON u.verified_email = $3
       WHERE w.slug = $1 AND a.external_key = $2`,
      [slug, agentKey, email],
    ),
  );
}

/**
 * Keeps one person's membership locked while the action runs, so their requests
 * really do time out against the database. Affects nobody else.
 */
export async function whileMembershipLocked<T>(
  slug: string,
  email: string,
  run: () => Promise<T>,
) {
  return withDatabase(async (client) => {
    await client.query("BEGIN");
    await client.query(
      `SELECT 1 FROM nodrail.workspace_memberships m
       JOIN nodrail.workspaces w ON w.id = m.workspace_id
       JOIN nodrail.users u ON u.id = m.user_id
       WHERE w.slug = $1 AND u.verified_email = $2
       FOR UPDATE OF m`,
      [slug, email],
    );
    try {
      return await run();
    } finally {
      await client.query("ROLLBACK");
    }
  });
}

export type RuleDraft = {
  name: string;
  operation: string;
  resourceKind: string;
  /** The form has no default; Allow unless given. */
  decision?: "Allow" | "Deny";
  agent?: string;
  resource?: string;
  match?: "exact" | "prefix";
};

/** Chooses a rule's decision in its form. */
export const chooseDecision = (page: Page, decision: RuleDraft["decision"]) =>
  page.getByRole("radio", { name: decision ?? "Allow", exact: true }).check();

/** The rule, gate or budget form's submit button: it publishes at once. */
export const publishButton = (page: Page) =>
  page.getByRole("button", { name: /^(Create|Save) and publish to / });

/** Publishes a rule through the real form. */
export async function createRule(page: Page, base: string, rule: RuleDraft) {
  await page.goto(`${base}/policies/new`);
  await page.getByLabel("Rule name").fill(rule.name);
  await chooseDecision(page, rule.decision);
  if (rule.agent) await page.getByLabel("Agent").selectOption(rule.agent);
  await page.getByLabel("Operation").fill(rule.operation);
  await page.getByLabel("Resource type").fill(rule.resourceKind);
  if (rule.match)
    await page.getByLabel("Which resources").selectOption(rule.match);
  if (rule.resource)
    await page.getByLabel("Resource", { exact: true }).fill(rule.resource);
  else await page.getByLabel("Which resources").selectOption("any");
  await publishButton(page).click();
  await page.waitForURL(/\/policies$/);
}

export async function openStandaloneSetup(page: Page) {
  await page
    .getByText("Standalone plugin, manual hook or SDK", { exact: true })
    .click();
}

/** Creates a standalone credential through the real form. */
export async function connect(page: Page, base: string, agentKey: string) {
  await page.goto(`${base}/agents/connect`);
  await openStandaloneSetup(page);
  await page.getByLabel("Agent ID").fill(agentKey);
  await page.getByRole("button", { name: "Create credential" }).click();
  const secret = page.getByLabel("Agent credential");
  await expect(secret).toBeVisible();
  return (await secret.textContent()) ?? "";
}

/** Confirms a risky action through its dialog. */
export async function confirm(page: Page, trigger: string, label: string) {
  await page.getByRole("button", { name: trigger, exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: label }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
}

/** Opens a row's "⋯" menu; the menu itself renders outside the row. */
export async function openRowMenu(page: Page, row: Locator) {
  // A menu closed a moment ago may still be fading out.
  await expect(page.getByRole("menu")).toHaveCount(0);
  await row.locator("[data-slot=row-actions]").click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  return menu;
}

/** Chooses an item from a row's "⋯" menu. */
export async function rowAction(page: Page, row: Locator, item: string) {
  const menu = await openRowMenu(page, row);
  await menu.getByRole("menuitem", { name: item, exact: true }).click();
}

/** Rules from YAML, previewed on the import page. */
export async function previewFile(page: Page, base: string, text: string) {
  await page.goto(`${base}/policies/import`);
  await page.getByLabel("Or paste YAML").fill(text);
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByRole("heading", { name: "Preview" })).toBeVisible();
}

export async function confirmPublish(page: Page) {
  await page.getByRole("button", { name: "Publish rules" }).first().click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Publish rules" })
    .click();
}

export async function publish(page: Page) {
  await confirmPublish(page);
  await page.waitForURL(/\/policies$/);
}

/** Copies a one-time secret with its Copy button and checks the clipboard. */
export async function expectCopied(page: Page, secret: string) {
  await page.getByRole("button", { name: "Copy", exact: true }).click();
  await expect(page.getByText("Copied.")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    secret,
  );
}
