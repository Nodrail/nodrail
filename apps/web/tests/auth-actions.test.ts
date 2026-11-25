import { expect, test, vi } from "vitest";
import {
  confirmSignIn,
  requestSignInLink,
  signInWithPassword,
} from "@/features/auth/actions";
import { after } from "next/server";
import { redeemLoginLink } from "@/server/auth/links";
import { passwordSignIn } from "@/server/auth/provider";
import { allowAttempt } from "@/server/auth/rate-limit";
import { newToken } from "@/server/auth/token";

vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/server/auth/links", () => ({ redeemLoginLink: vi.fn() }));
vi.mock("@/server/auth/provider", () => ({ passwordSignIn: vi.fn() }));
vi.mock("@/server/auth/source", () => ({ loginSource: () => "192.0.2.2" }));
vi.mock("@/server/auth/rate-limit", () => ({ allowAttempt: vi.fn() }));
vi.mock("@/server/notifications/mailer", () => ({
  emailConfigured: () => true,
}));

test("throttled login requests get a generic retry before touching authentication state", async () => {
  vi.mocked(allowAttempt).mockResolvedValue(false);
  const data = new FormData();
  const email = "person@example.test";
  const token = newToken();
  data.set("email", email);
  data.set("password", "some valid password");
  data.set("token", token);
  const initial = { status: "idle" } as const;
  const retry = { status: "retry" };

  await expect(requestSignInLink(initial, data)).resolves.toEqual(retry);
  await expect(signInWithPassword(initial, data)).resolves.toEqual(retry);
  await expect(confirmSignIn(initial, data)).resolves.toEqual(retry);
  expect(vi.mocked(allowAttempt).mock.calls).toEqual([
    ["email", "192.0.2.2", email],
    ["password", "192.0.2.2", email],
    ["redeem", "192.0.2.2", token],
  ]);
  expect(after).not.toHaveBeenCalled();
  expect(passwordSignIn).not.toHaveBeenCalled();
  expect(redeemLoginLink).not.toHaveBeenCalled();
});
