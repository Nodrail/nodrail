import { randomUUID } from "node:crypto";
import { describe, expect, test, vi } from "vitest";
import { deliverLoginLink, redeemLoginLink } from "@/server/auth/links";
import { hashPassword } from "@/server/auth/password";
import { passwordSignIn } from "@/server/auth/provider";
import { allowAttempt } from "@/server/auth/rate-limit";
import {
  issueSession,
  resolveSession,
  revokeSession,
} from "@/server/auth/sessions";
import { createVerifiedAccount } from "@/server/auth/store";
import { newToken, tokenDigest } from "@/server/auth/token";
import { asAuthenticator, withUser } from "@/server/db/context";
import { HumanSession, User } from "@/server/db/entities";
import { sendLoginEmail } from "@/server/auth/mail";
import { admin, appDirect, useDatabase } from "./world";

vi.mock("@/server/auth/mail", () => ({ sendLoginEmail: vi.fn() }));
useDatabase();

const freshEmail = () => `${randomUUID()}@example.test`;
const password = "weekly-test-password";
const linkOptions = { canSignup: () => true };

async function createLogin(email = freshEmail(), hash: string | null = null) {
  const id = await admin.transaction((manager) =>
    createVerifiedAccount(manager, email, hash),
  );
  return { id, email };
}

async function requestLink(email: string, kind: "verify" | "reset") {
  await deliverLoginLink(email, kind, true);
  const call = vi
    .mocked(sendLoginEmail)
    .mock.calls.findLast(([to, purpose]) => to === email && purpose === kind);
  if (!call) throw new Error("Expected an email link");
  return call[2];
}

describe("browser sessions", () => {
  test("a successful login keeps its user ID and rotates the browser credential", async () => {
    const { id, email } = await createLogin(
      freshEmail(),
      await hashPassword(password),
    );
    const first = await passwordSignIn(email, password);
    if (!first) throw new Error("sign-in failed");
    const principal = await resolveSession(first.token);
    if (!principal) throw new Error("expected a session");
    expect(principal.userId).toBe(id);
    const row = await admin
      .getRepository(HumanSession)
      .findOneByOrFail({ id: principal.sessionId });
    expect(row.tokenDigest).toBe(tokenDigest(first.token));

    const next = await passwordSignIn(email, password, first.token);
    expect(next?.token).toBeDefined();
    expect(next?.token).not.toBe(first.token);
    await expect(resolveSession(first.token)).resolves.toBeNull();
    await expect(resolveSession(next?.token)).resolves.toMatchObject({
      userId: id,
    });
    await expect(withUser(principal, async () => true)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });

  test("logout revokes only the current session", async () => {
    const { id } = await createLogin();
    const one = await admin.transaction((manager) => issueSession(manager, id));
    const two = await admin.transaction((manager) => issueSession(manager, id));
    await revokeSession(one.token);
    await revokeSession(one.token);
    await expect(resolveSession(one.token)).resolves.toBeNull();
    await expect(resolveSession(two.token)).resolves.toMatchObject({
      userId: id,
    });
  });

  test("expired, unknown and suspended sessions are refused", async () => {
    const { id } = await createLogin();
    const session = await admin.transaction((manager) =>
      issueSession(manager, id),
    );
    await admin.query(
      `UPDATE nodrail.human_sessions
       SET created_at = now() - interval '2 days', expires_at = now() - interval '1 day'
       WHERE token_digest = $1`,
      [tokenDigest(session.token)],
    );
    await expect(resolveSession(session.token)).resolves.toBeNull();
    await expect(resolveSession(newToken())).resolves.toBeNull();
    const active = await admin.transaction((manager) =>
      issueSession(manager, id),
    );
    await admin.getRepository(User).update({ id }, { status: "suspended" });
    await expect(resolveSession(active.token)).resolves.toBeNull();
  });
});

describe("email links and password changes", () => {
  test("a verification link creates one verified person even if submitted twice", async () => {
    const email = freshEmail();
    const token = await requestLink(email, "verify");
    const sessions = await Promise.all([
      redeemLoginLink(token, linkOptions),
      redeemLoginLink(token, linkOptions),
    ]);
    expect(sessions.filter(Boolean)).toHaveLength(1);
    const principal = await resolveSession(sessions.find(Boolean)?.token);
    const user = await admin
      .getRepository(User)
      .findOneByOrFail({ id: principal?.userId });
    expect(user.verifiedEmail).toBe(email);
    expect(user.displayName).toBe(email);
  });

  test("reset enables password sign-in for a migrated account and revokes all old sessions", async () => {
    const { id, email } = await createLogin();
    const old = await admin.transaction((manager) => issueSession(manager, id));
    const reset = await requestLink(email, "reset");
    await expect(redeemLoginLink(reset, linkOptions)).resolves.toBeNull();
    await expect(
      redeemLoginLink(reset, { ...linkOptions, password }),
    ).resolves.toBeTruthy();
    await expect(resolveSession(old.token)).resolves.toBeNull();
    await expect(
      redeemLoginLink(reset, { ...linkOptions, password }),
    ).resolves.toBeNull();
    const session = await passwordSignIn(email, password);
    await expect(resolveSession(session?.token)).resolves.toMatchObject({
      userId: id,
    });
  });

  test("a suspended account reserves its email even when signup is open", async () => {
    const { id, email } = await createLogin();
    const token = await requestLink(email, "verify");
    await admin.getRepository(User).update({ id }, { status: "suspended" });
    const deliveries = vi.mocked(sendLoginEmail).mock.calls.length;
    await deliverLoginLink(email, "verify", true);
    expect(sendLoginEmail).toHaveBeenCalledTimes(deliveries);
    await expect(redeemLoginLink(token, linkOptions)).resolves.toBeNull();

    await admin.getRepository(User).update({ id }, { status: "active" });
    const session = await redeemLoginLink(token, linkOptions);
    await expect(resolveSession(session?.token)).resolves.toMatchObject({
      userId: id,
    });
  });

  test("unknown and passwordless users return the same password failure", async () => {
    const { email } = await createLogin();
    await expect(passwordSignIn(email, password)).resolves.toBeNull();
    await expect(passwordSignIn(freshEmail(), password)).resolves.toBeNull();
    const unknown = freshEmail();
    await deliverLoginLink(unknown, "reset", true);
    expect(sendLoginEmail).not.toHaveBeenCalledWith(
      unknown,
      "reset",
      expect.anything(),
    );
  });

  test("login and email windows limit attempts by address regardless of account status", async () => {
    const email = freshEmail();
    for (const [kind, cap] of [
      ["password", 10],
      ["email", 5],
    ] as const) {
      for (let attempt = 0; attempt < cap; attempt += 1)
        await expect(allowAttempt(kind, "address-test", email)).resolves.toBe(
          true,
        );
      await expect(allowAttempt(kind, "address-test", email)).resolves.toBe(
        false,
      );
    }
  });
  test.each([
    ["password", 20],
    ["email", 30],
    ["redeem", 30],
  ] as const)(
    "%s limits a source before charging the deployment-wide window",
    async (kind, cap) => {
      const source = randomUUID();
      for (let attempt = 0; attempt < cap; attempt += 1)
        expect(await allowAttempt(kind, source, randomUUID())).toBe(true);
      const budget = () =>
        admin.query(
          "SELECT expires_at, attempts FROM nodrail.login_rate_windows WHERE key = $1",
          [kind],
        );
      const before = await budget();
      expect(before).toHaveLength(1);
      expect(await allowAttempt(kind, source, randomUUID())).toBe(false);
      expect(await budget()).toEqual(before);
      expect(await allowAttempt(kind, randomUUID(), randomUUID())).toBe(true);
    },
  );
});

describe("pre-tenant database access", () => {
  test("the authentication login cannot see or delete legacy sessions", async () => {
    const { id } = await createLogin();
    const [legacy] = await admin.query(
      `WITH identity AS (
        INSERT INTO nodrail.external_auth_accounts (user_id, provider, issuer, subject)
        VALUES ($1, 'legacy', 'example.test', $1::uuid::text) RETURNING id
      )
      INSERT INTO nodrail.human_sessions
        (user_id, external_auth_account_id, provider_session_id, expires_at)
      SELECT $1, identity.id, $1::uuid::text, now() + interval '1 day' FROM identity
      RETURNING id`,
      [id],
    );
    await asAuthenticator(async (manager) => {
      await expect(
        manager.query("SELECT id FROM nodrail.human_sessions WHERE id = $1", [
          legacy.id,
        ]),
      ).resolves.toEqual([]);
      await manager.query("DELETE FROM nodrail.human_sessions WHERE id = $1", [
        legacy.id,
      ]);
    });
    await expect(
      admin.getRepository(HumanSession).existsBy({ id: legacy.id }),
    ).resolves.toBe(true);
  });

  test("the authentication role sees auth records but cannot touch tenant data", async () => {
    await expect(
      appDirect.query("SELECT * FROM nodrail.login_accounts"),
    ).rejects.toThrow(/permission denied/);
    await expect(appDirect.query("SET ROLE nodrail_auth")).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      appDirect.query("UPDATE nodrail.login_accounts SET password_hash = NULL"),
    ).rejects.toThrow(/permission denied/);
    await expect(
      appDirect.query("INSERT INTO nodrail.human_sessions DEFAULT VALUES"),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asAuthenticator((manager) => manager.query("SET LOCAL ROLE nodrail_app")),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asAuthenticator((manager) =>
        manager.query("SELECT * FROM nodrail.workspaces"),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asAuthenticator((manager) =>
        manager.query(
          "UPDATE nodrail.login_accounts SET email = 'wrong@example.test'",
        ),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});
