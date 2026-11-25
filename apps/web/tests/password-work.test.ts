import { expect, test, vi } from "vitest";
import {
  passwordWorkBusy,
  withPasswordWork,
} from "@/server/auth/password-work";

test("password work has two concurrent slots that release even on failure", async () => {
  const first = Promise.withResolvers<number>();
  const second = Promise.withResolvers<number>();
  const a = withPasswordWork(() => first.promise);
  const b = withPasswordWork(() => second.promise);
  const run = vi.fn(async () => 3);
  await expect(withPasswordWork(run)).resolves.toBe(passwordWorkBusy);
  expect(run).not.toHaveBeenCalled();

  first.reject(new Error("password work failed"));
  await expect(a).rejects.toThrow("password work failed");
  await expect(withPasswordWork(run)).resolves.toBe(3);
  second.resolve(2);
  await expect(b).resolves.toBe(2);
});
